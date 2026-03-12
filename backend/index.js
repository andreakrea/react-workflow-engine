const path = require('path');
const WorkflowEngine = require('./WorkflowEngine');
const WorkflowHooksDispatcher = require('./WorkflowHooksDispatcher');
const { createWorkflowRouter } = require('./router');
const { validateLicense, getLicenseInfo } = require('./license');

const migrationsPath = path.join(__dirname, 'migrations');

module.exports = {
  validateLicense,
  getLicenseInfo,
  WorkflowEngine,
  WorkflowHooksDispatcher,
  createWorkflowRouter,
  migrationsPath,
};
