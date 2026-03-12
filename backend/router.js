/**
 * createWorkflowRouter — Express router factory for workflow CRUD.
 *
 * Mounts the five standard endpoints (list, get, create, update, delete)
 * against the `workflows` table. Optionally wraps every route with your own
 * auth middleware.
 *
 * ─── Usage ──────────────────────────────────────────────────────────────────
 *
 *   const express = require('express');
 *   const { createWorkflowRouter } = require('@workflow-engine/backend');
 *
 *   const app = express();
 *   app.use(express.json());
 *
 *   app.use(
 *     '/api/workflows',
 *     createWorkflowRouter({
 *       knex,
 *       authMiddleware: requireAuth,   // optional Express middleware
 *     })
 *   );
 *
 * ─── Endpoints ───────────────────────────────────────────────────────────────
 *
 *   GET    /           → { success, workflows: [...] }
 *   GET    /:id        → { success, workflow: {...} }
 *   POST   /           → { success, message, workflow: {...} }  body: { name, nodes, edges, hooks?, description?, created_by? }
 *   PUT    /:id        → { success, message, workflow: {...} }  body: any subset of the above
 *   DELETE /:id        → { success, message }
 */
const express = require('express');

function parseWorkflow(row) {
  return {
    ...row,
    nodes: typeof row.nodes === 'string' ? JSON.parse(row.nodes) : row.nodes,
    edges: typeof row.edges === 'string' ? JSON.parse(row.edges) : row.edges,
    hooks: typeof row.hooks === 'string' ? JSON.parse(row.hooks) : (row.hooks || []),
  };
}

function createWorkflowRouter({ knex, authMiddleware } = {}) {
  const { _requireLicense } = require('./license');
  _requireLicense('createWorkflowRouter');

  if (!knex) throw new Error('createWorkflowRouter: knex is required');

  const router = express.Router();

  if (authMiddleware) {
    router.use(authMiddleware);
  }

  // ── GET / ─────────────────────────────────────────────────────────────────
  router.get('/', async (req, res) => {
    try {
      const rows = await knex('workflows').select('*').orderBy('created_at', 'desc');
      res.json({ success: true, workflows: rows.map(parseWorkflow) });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch workflows',
        message: err.message,
      });
    }
  });

  // ── GET /:id ──────────────────────────────────────────────────────────────
  router.get('/:id', async (req, res) => {
    try {
      const row = await knex('workflows').where({ id: req.params.id }).first();
      if (!row) {
        return res.status(404).json({ success: false, error: 'Workflow not found' });
      }
      res.json({ success: true, workflow: parseWorkflow(row) });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch workflow',
        message: err.message,
      });
    }
  });

  // ── POST / ────────────────────────────────────────────────────────────────
  router.post('/', async (req, res) => {
    try {
      const { name, description, nodes, edges, hooks, created_by } = req.body;

      if (!name || !nodes || !edges) {
        return res.status(400).json({
          success: false,
          error: 'name, nodes, and edges are required',
        });
      }

      const [result] = await knex('workflows')
        .insert({
          name,
          description: description || null,
          nodes: JSON.stringify(nodes),
          edges: JSON.stringify(edges),
          hooks: JSON.stringify(hooks || []),
          created_by: created_by || null,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        })
        .returning('id');

      const id = result?.id || result;
      const workflow = await knex('workflows').where({ id }).first();

      res.status(201).json({
        success: true,
        message: 'Workflow created successfully',
        workflow: parseWorkflow(workflow),
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to create workflow',
        message: err.message,
      });
    }
  });

  // ── PUT /:id ──────────────────────────────────────────────────────────────
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await knex('workflows').where({ id }).first();
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Workflow not found' });
      }

      const { name, description, nodes, edges, hooks } = req.body;
      const update = { updated_at: knex.fn.now() };

      if (name !== undefined) update.name = name;
      if (description !== undefined) update.description = description;
      if (nodes !== undefined) update.nodes = JSON.stringify(nodes);
      if (edges !== undefined) update.edges = JSON.stringify(edges);
      if (hooks !== undefined) update.hooks = JSON.stringify(hooks);

      await knex('workflows').where({ id }).update(update);

      const workflow = await knex('workflows').where({ id }).first();

      res.json({
        success: true,
        message: 'Workflow updated successfully',
        workflow: parseWorkflow(workflow),
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to update workflow',
        message: err.message,
      });
    }
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────────
  router.delete('/:id', async (req, res) => {
    try {
      const deleted = await knex('workflows').where({ id: req.params.id }).del();
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'Workflow not found' });
      }
      res.json({ success: true, message: 'Workflow deleted successfully' });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to delete workflow',
        message: err.message,
      });
    }
  });

  return router;
}

module.exports = { createWorkflowRouter };
