const path = require('path');
const WorkflowEngine = require('./WorkflowEngine');
const WorkflowHooksDispatcher = require('./WorkflowHooksDispatcher');
const { createWorkflowRouter } = require('./router');

const migrationsPath = path.join(__dirname, 'migrations');

module.exports = {
  WorkflowEngine,
  WorkflowHooksDispatcher,
  createWorkflowRouter,
  migrationsPath,
};
