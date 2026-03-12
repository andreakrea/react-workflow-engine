/**
 * WorkflowEngine — Generic graph-based state machine.
 *
 * Zero domain knowledge. Knows nothing about disputes, users, or messaging.
 * All domain behaviour is injected via the options below.
 *
 * ─── Constructor options ────────────────────────────────────────────────────
 *
 *   knex  {object}  Required. A Knex instance used to query the `workflows`
 *                   table (the only table this engine owns).
 *
 *   subjectRepo  {object}  Required. Adapter that bridges the engine to
 *                          whichever entity (dispute, ticket, order …) is
 *                          moving through the workflow. Must implement:
 *
 *     getById(id)
 *       → { id, workflowId, currentNodeId, status, ...rest }
 *
 *     updateState(id, newNodeId, newNodeType)
 *       → void  (persist current_node_id + status on the entity)
 *
 *     setWorkflow(id, workflowId, initialNodeId, initialNodeType)
 *       → void  (called once when a workflow is first assigned to the entity)
 *
 *   actionRegistry  {object}  Optional external action registry. If provided
 *                             it must implement:
 *     execute(nodeType, subject, context)
 *       → { success, autoProgress?, decision?, ...rest }
 *
 *     Alternatively, register actions inline:
 *       engine.registerAction('my_node_type', async (subject, context) => { … })
 *
 *   hookDispatcher  {object}  Optional external hook dispatcher. If provided
 *                             it must implement:
 *     execute(hook, subject, context)
 *       → { success, ...rest }
 *
 *     Alternatively, register hooks inline:
 *       engine.registerHook('my_hook_type', async (subject, hook, context) => { … })
 *
 *   onCancelTracking(subjectId, nodeId)  Optional async callback, called
 *     before a transition to cancel any pending tracking on the departing node.
 *
 *   onLogHookExecution(subjectId, hookData)  Optional async callback, called
 *     after each hook execution to persist the execution log.
 *
 * ─── Usage example ──────────────────────────────────────────────────────────
 *
 *   const { WorkflowEngine } = require('@workflow-engine/backend');
 *
 *   const engine = new WorkflowEngine({
 *     knex,
 *     subjectRepo: {
 *       async getById(id) {
 *         const row = await knex('tickets').where({ id }).first();
 *         return row ? {
 *           id: row.id,
 *           workflowId: row.workflow_id,
 *           currentNodeId: row.current_node_id,
 *           status: row.status,
 *         } : null;
 *       },
 *       async updateState(id, nodeId, nodeType) {
 *         await knex('tickets').where({ id }).update({
 *           current_node_id: nodeId,
 *           status: nodeType,
 *           updated_at: knex.fn.now(),
 *         });
 *       },
 *       async setWorkflow(id, workflowId, nodeId, nodeType) {
 *         await knex('tickets').where({ id }).update({
 *           workflow_id: workflowId,
 *           current_node_id: nodeId,
 *           status: nodeType,
 *           updated_at: knex.fn.now(),
 *         });
 *       },
 *     },
 *   });
 *
 *   engine.registerAction('send_email', async (subject, context) => {
 *     await sendEmail(subject.email, 'You have a new ticket');
 *     return { success: true, autoProgress: false };
 *   });
 *
 *   await engine.initializeSubject(ticketId, workflowId);
 *   await engine.transition(ticketId, 'awaiting_review');
 *   await engine.transitionByDecision(ticketId, true); // YES branch
 */
class WorkflowEngine {
  constructor({
    knex,
    subjectRepo,
    actionRegistry,
    hookDispatcher,
    onCancelTracking,
    onLogHookExecution,
  } = {}) {
    const { _requireLicense } = require('./license');
    _requireLicense('WorkflowEngine');

    if (!knex) throw new Error('WorkflowEngine: knex is required');
    if (!subjectRepo) throw new Error('WorkflowEngine: subjectRepo is required');

    this._knex = knex;
    this._subjectRepo = subjectRepo;
    this._actionRegistryExternal = actionRegistry || null;
    this._hookDispatcherExternal = hookDispatcher || null;
    this._onCancelTracking = onCancelTracking || null;
    this._onLogHookExecution = onLogHookExecution || null;

    // Inline registries (used when no external registry is provided)
    this._actions = {};
    this._hookHandlers = {};
  }

  // ─── Inline registration helpers ──────────────────────────────────────────

  /**
   * Register a handler for a specific node type.
   * fn(subject, context) => { success, autoProgress?, decision?, ... }
   */
  registerAction(nodeType, fn) {
    this._actions[nodeType] = fn;
    return this;
  }

  /**
   * Register a handler for a specific hook type.
   * fn(subject, hook, context) => { success, ... }
   */
  registerHook(hookType, fn) {
    this._hookHandlers[hookType] = fn;
    return this;
  }

  // ─── Internal dispatch ────────────────────────────────────────────────────

  async _executeAction(nodeType, subject, context) {
    if (this._actionRegistryExternal) {
      return await this._actionRegistryExternal.execute(nodeType, subject, context);
    }
    const fn = this._actions[nodeType];
    if (!fn) {
      console.warn(`WorkflowEngine: no action registered for node type "${nodeType}" — skipping`);
      return { success: true, autoProgress: false };
    }
    return await fn(subject, context);
  }

  async _executeHookAction(hook, subject, context) {
    if (this._hookDispatcherExternal) {
      return await this._hookDispatcherExternal.execute(hook, subject, context);
    }
    const fn = this._hookHandlers[hook.type];
    if (!fn) {
      console.warn(`WorkflowEngine: no handler registered for hook type "${hook.type}" — skipping`);
      return { success: false, error: `Unknown hook type: ${hook.type}` };
    }
    return await fn(subject, hook, context);
  }

  // ─── Workflow CRUD (engine owns the workflows table) ──────────────────────

  async getWorkflow(workflowId) {
    const workflow = await this._knex('workflows').where({ id: workflowId }).first();
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    return {
      ...workflow,
      nodes: typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) : workflow.nodes,
      edges: typeof workflow.edges === 'string' ? JSON.parse(workflow.edges) : workflow.edges,
      hooks: typeof workflow.hooks === 'string' ? JSON.parse(workflow.hooks) : (workflow.hooks || []),
    };
  }

  // ─── Pure graph traversal (no DB, no side effects) ────────────────────────

  /**
   * Returns { nodeId, nodeType } for the initial (start) node of a workflow.
   * Prefers a node whose data.type === 'start'; falls back to nodes[0].
   */
  getInitialState(workflow) {
    if (!workflow.nodes || workflow.nodes.length === 0) return null;
    const startNode =
      workflow.nodes.find(n => n.data?.type === 'start') ||
      workflow.nodes.find(n => n.data?.type === 'created') ||
      workflow.nodes[0];
    return startNode
      ? { nodeId: startNode.id, nodeType: startNode.data?.type }
      : null;
  }

  /**
   * Returns all valid next states from the given node.
   * currentNodeId can be a node id OR a node type (backward compat).
   */
  getNextStates(workflow, currentNodeId) {
    const currentNode =
      workflow.nodes.find(n => n.id === currentNodeId) ||
      workflow.nodes.find(n => n.data?.type === currentNodeId);
    if (!currentNode) return [];

    return workflow.edges
      .filter(e => e.source === currentNode.id)
      .map(edge => {
        const target = workflow.nodes.find(n => n.id === edge.target);
        return { nodeId: target?.id, nodeType: target?.data?.type, edge };
      })
      .filter(s => s.nodeId && s.nodeType);
  }

  /**
   * Choose the correct next node when there are multiple outgoing edges
   * (decision nodes). decision can be boolean or a string condition name.
   */
  getNextStateByDecision(workflow, currentNodeId, decision) {
    const currentNode =
      workflow.nodes.find(n => n.id === currentNodeId) ||
      workflow.nodes.find(n => n.data?.type === currentNodeId);
    if (!currentNode) return null;

    const outgoing = workflow.edges.filter(e => e.source === currentNode.id);
    if (outgoing.length === 0) return null;

    // Single edge — decision irrelevant
    if (outgoing.length === 1) {
      const t = workflow.nodes.find(n => n.id === outgoing[0].target);
      return t ? { nodeId: t.id, nodeType: t.data?.type } : null;
    }

    const posHandles = ['true', 'yes', 'confirmed', 'accepted', 'progress', 'success', 'approved'];
    const negHandles = ['false', 'no', 'declined', 'cancel', 'rejected'];

    let selectedEdge = null;

    // Exact handle/label/condition match
    if (typeof decision === 'boolean') {
      selectedEdge = outgoing.find(e =>
        e.sourceHandle === (decision ? 'true' : 'false') ||
        e.sourceHandle === (decision ? 'success' : 'cancel')
      );
    } else if (typeof decision === 'string') {
      selectedEdge = outgoing.find(e =>
        e.sourceHandle === decision ||
        e.label === decision ||
        e.data?.condition === decision
      );
    }

    // Semantic fallback
    if (!selectedEdge) {
      const norm = typeof decision === 'string' ? decision.toLowerCase() : decision;
      const isPos = decision === true || ['confirmed', 'accepted', 'progress', 'approved'].includes(norm);
      const isNeg = decision === false || ['declined', 'cancel'].includes(norm);

      if (isPos) {
        selectedEdge =
          outgoing.find(e => posHandles.includes(String(e.sourceHandle).toLowerCase())) ||
          outgoing.find(e => !negHandles.includes(String(e.sourceHandle).toLowerCase())) ||
          outgoing[0];
      } else if (isNeg) {
        selectedEdge =
          outgoing.find(e => negHandles.includes(String(e.sourceHandle).toLowerCase())) ||
          outgoing.find(e => !posHandles.includes(String(e.sourceHandle).toLowerCase())) ||
          outgoing[1] ||
          outgoing[0];
      } else {
        selectedEdge = outgoing[0];
      }
    }

    const target = workflow.nodes.find(n => n.id === (selectedEdge || outgoing[0]).target);
    return target ? { nodeId: target.id, nodeType: target.data?.type } : null;
  }

  // ─── State machine operations ─────────────────────────────────────────────

  async canTransition(subjectId, newNodeId) {
    const subject = await this._subjectRepo.getById(subjectId);
    if (!subject) throw new Error(`Subject ${subjectId} not found`);
    if (!subject.workflowId) return true; // no workflow assigned → allow freely

    const workflow = await this.getWorkflow(subject.workflowId);
    const currentNodeId = subject.currentNodeId || subject.status;
    if (currentNodeId === newNodeId) return true;

    const allowed = this.getNextStates(workflow, currentNodeId);
    return allowed.some(s => s.nodeId === newNodeId || s.nodeType === newNodeId);
  }

  /**
   * Transition the subject to a new node.
   * newNodeIdOrType can be either the exact node id ("node_3") or the node
   * type string ("waiting_review") — both are resolved correctly.
   */
  async transition(subjectId, newNodeIdOrType, context = {}) {
    const subject = await this._subjectRepo.getById(subjectId);
    if (!subject) throw new Error(`Subject ${subjectId} not found`);

    const workflow = await this.getWorkflow(subject.workflowId);

    // Resolve the target node
    let newNodeId, newNodeType;
    const nodeById = workflow.nodes.find(n => n.id === newNodeIdOrType);
    if (nodeById) {
      newNodeId = nodeById.id;
      newNodeType = nodeById.data?.type;
    } else {
      const nodeByType = workflow.nodes.find(n => n.data?.type === newNodeIdOrType);
      if (nodeByType) {
        newNodeId = nodeByType.id;
        newNodeType = nodeByType.data?.type;
      } else {
        throw new Error(`Node not found: ${newNodeIdOrType}`);
      }
    }

    const ok = await this.canTransition(subjectId, newNodeId);
    if (!ok) {
      throw new Error(
        `Invalid transition from ${subject.currentNodeId || subject.status} to ${newNodeId}`
      );
    }

    // -- on_node_exit hooks --
    await this._executeHooks(subjectId, 'on_node_exit', {
      ...context,
      currentNodeId: subject.currentNodeId,
      nextNodeId: newNodeId,
    });

    // Cancel any pending tracking on the node being left
    if (subject.currentNodeId && this._onCancelTracking) {
      await this._onCancelTracking(subjectId, subject.currentNodeId);
    }

    // Persist the new state
    await this._subjectRepo.updateState(subjectId, newNodeId, newNodeType);
    const updatedSubject = await this._subjectRepo.getById(subjectId);

    // -- on_transition hooks --
    await this._executeHooks(subjectId, 'on_transition', {
      ...context,
      fromNodeId: subject.currentNodeId,
      toNodeId: newNodeId,
      currentNodeId: newNodeId,
    });

    // -- on_node_entry hooks --
    await this._executeHooks(subjectId, 'on_node_entry', {
      ...context,
      currentNodeId: newNodeId,
      previousNodeId: subject.currentNodeId,
    });

    // Execute the action handler for this node type
    const actionResult = await this._executeAction(newNodeType, updatedSubject, context);

    // Auto-progress if the action says so
    if (actionResult.autoProgress && updatedSubject.workflowId) {
      const nextStates = await this.getAvailableTransitions(subjectId);
      if (nextStates.length === 1) {
        return await this.transition(subjectId, nextStates[0].nodeId, {
          ...context,
          autoProgressed: true,
        });
      }
      if (nextStates.length > 1 && actionResult.decision !== undefined) {
        const nextState = this.getNextStateByDecision(workflow, newNodeId, actionResult.decision);
        if (nextState?.nodeId) {
          return await this.transition(subjectId, nextState.nodeId, {
            ...context,
            autoProgressed: true,
            decision: actionResult.decision,
          });
        }
      }
    }

    return { ...updatedSubject, actionResult };
  }

  /**
   * Make a decision-based transition from the current node.
   * Useful when you already know the user's answer (true/false/string).
   */
  async transitionByDecision(subjectId, decision, context = {}) {
    const subject = await this._subjectRepo.getById(subjectId);
    if (!subject) throw new Error(`Subject ${subjectId} not found`);
    if (!subject.workflowId) throw new Error(`Subject ${subjectId} has no workflow assigned`);

    const workflow = await this.getWorkflow(subject.workflowId);
    const currentNodeId = subject.currentNodeId || subject.status;
    const nextState = this.getNextStateByDecision(workflow, currentNodeId, decision);

    if (!nextState?.nodeId) {
      throw new Error(`No valid transition from ${currentNodeId} with decision: ${decision}`);
    }

    return await this.transition(subjectId, nextState.nodeId, { ...context, decision });
  }

  /**
   * Assign a workflow to a subject and land on the initial node.
   * Fires the initial node's action (and auto-progresses if needed).
   */
  async initializeSubject(subjectId, workflowId, context = {}) {
    const workflow = await this.getWorkflow(workflowId);
    const initial = this.getInitialState(workflow);
    if (!initial) throw new Error(`No initial state found in workflow ${workflowId}`);

    await this._subjectRepo.setWorkflow(subjectId, workflowId, initial.nodeId, initial.nodeType);
    const subject = await this._subjectRepo.getById(subjectId);

    const actionResult = await this._executeAction(initial.nodeType, subject, context);

    if (actionResult.autoProgress) {
      const nextStates = await this.getAvailableTransitions(subjectId);
      if (nextStates.length === 1) {
        return await this.transition(subjectId, nextStates[0].nodeId, {
          ...context,
          autoProgressed: true,
        });
      }
    }

    return { ...subject, actionResult };
  }

  /**
   * Returns the list of valid next nodes from the subject's current position.
   */
  async getAvailableTransitions(subjectId) {
    const subject = await this._subjectRepo.getById(subjectId);
    if (!subject) throw new Error(`Subject ${subjectId} not found`);
    if (!subject.workflowId) return [];

    const workflow = await this.getWorkflow(subject.workflowId);
    const currentNodeId = subject.currentNodeId || subject.status;
    return this.getNextStates(workflow, currentNodeId);
  }

  /**
   * Public entry point to fire lifecycle hooks externally
   * (e.g. call this from your webhook handler on every incoming message).
   */
  async executeHooks(subjectId, trigger, context = {}) {
    return this._executeHooks(subjectId, trigger, context);
  }

  // ─── Internal hook execution ──────────────────────────────────────────────

  async _executeHooks(subjectId, trigger, context = {}) {
    try {
      const subject = await this._subjectRepo.getById(subjectId);
      if (!subject?.workflowId) return;

      const workflow = await this.getWorkflow(subject.workflowId);
      if (!workflow.hooks?.length) return;

      const applicable = workflow.hooks.filter(hook => {
        if (hook.trigger !== trigger) return false;
        if (hook.scope === 'all') return true;
        if (Array.isArray(hook.scope)) {
          return hook.scope.includes(context.currentNodeId || subject.currentNodeId);
        }
        return false;
      });

      const results = await Promise.allSettled(
        applicable.map(hook => this._executeHookSingle(hook, subject, context))
      );

      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        console.warn(
          `WorkflowEngine: ${results.length - failed} hooks ok, ${failed} failed for subject ${subjectId}`
        );
      }
      return results;
    } catch (err) {
      console.error('WorkflowEngine: error executing hooks:', err);
    }
  }

  async _executeHookSingle(hook, subject, context) {
    if (hook.enabled === false) return { skipped: true, reason: 'Hook disabled' };

    const result = await this._executeHookAction(hook, subject, context);

    if (hook.logExecution !== false && this._onLogHookExecution) {
      await this._onLogHookExecution(subject.id, {
        hookId: hook.id,
        hookType: hook.type,
        trigger: hook.trigger,
        timestamp: new Date().toISOString(),
        result: result.success ? 'success' : 'failed',
      });
    }

    return result;
  }
}

module.exports = WorkflowEngine;
