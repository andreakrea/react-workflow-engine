/**
 * WorkflowHooksDispatcher — Plugin registry for lifecycle hook handlers.
 *
 * Register one handler per hook type. The engine calls dispatcher.execute()
 * automatically at the right lifecycle moment (on_message, on_transition,
 * on_node_entry, on_node_exit).
 *
 * ─── Usage ──────────────────────────────────────────────────────────────────
 *
 *   const { WorkflowEngine, WorkflowHooksDispatcher } = require('@workflow-engine/backend');
 *
 *   const hookDispatcher = new WorkflowHooksDispatcher();
 *
 *   hookDispatcher.register('send_slack_alert', async (subject, hook, context) => {
 *     await slack.post(`Ticket ${subject.id} entered ${context.currentNodeId}`);
 *     return { success: true };
 *   });
 *
 *   hookDispatcher.register('escalation_detector', async (subject, hook, context) => {
 *     const messages = await getMessages(subject.id);
 *     const isEscalating = await myAI.detectEscalation(messages);
 *     if (isEscalating) await flagTicket(subject.id);
 *     return { success: true, isEscalating };
 *   });
 *
 *   const engine = new WorkflowEngine({ knex, subjectRepo, hookDispatcher });
 *
 * ─── Handler signature ───────────────────────────────────────────────────────
 *
 *   async (subject, hook, context) => { success: boolean, ...anything }
 *
 *   subject  — the entity object returned by subjectRepo.getById()
 *   hook     — the hook config from the workflow definition
 *              { id, type, trigger, scope, enabled, config: { ... } }
 *   context  — the engine context object, always includes currentNodeId
 */
class WorkflowHooksDispatcher {
  constructor() {
    this._handlers = {};
  }

  /**
   * Register a handler for a hook type.
   * Returns `this` so calls can be chained.
   */
  register(hookType, fn) {
    this._handlers[hookType] = fn;
    return this;
  }

  /**
   * Called by the engine. Dispatches to the matching registered handler.
   */
  async execute(hook, subject, context = {}) {
    const fn = this._handlers[hook.type];
    if (!fn) {
      console.warn(
        `WorkflowHooksDispatcher: no handler registered for hook type "${hook.type}"`
      );
      return { success: false, error: `Unknown hook type: ${hook.type}` };
    }
    try {
      return await fn(subject, hook, context);
    } catch (err) {
      console.error(`WorkflowHooksDispatcher: error in hook "${hook.type}":`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Returns all registered hook type names.
   */
  registeredTypes() {
    return Object.keys(this._handlers);
  }
}

module.exports = WorkflowHooksDispatcher;
