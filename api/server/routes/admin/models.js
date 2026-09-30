const express = require('express');
const { createAdminModelsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability, hasCapability } = require('~/server/middleware/roles/capabilities');
const { invalidateConfigCaches, getEndpointsConfig } = require('~/server/services/Config');
const { loadServedModels } = require('~/server/controllers/ModelController');
const { governance } = require('~/server/services/Governance');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const {
  getYamlConfig,
  getTenantConfig,
  recordAdminAction,
} = require('~/server/services/AdminPanel');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadModels = requireCapability(SystemCapabilities.READ_MODELS);
const requireManageModels = requireCapability(SystemCapabilities.MANAGE_MODELS);
const requireManageConfigs = requireCapability(SystemCapabilities.MANAGE_CONFIGS);

const handlers = createAdminModelsHandlers({
  loadAvailableModels: loadServedModels,
  getEndpointsConfig,
  getTenantConfig,
  getYamlConfig,
  listModelPolicies: db.listModelPolicies,
  findModelPolicyById: db.findModelPolicyById,
  createModelPolicy: db.createModelPolicy,
  updateModelPolicy: db.updateModelPolicy,
  deleteModelPolicy: db.deleteModelPolicy,
  findConfigByPrincipal: db.findConfigByPrincipal,
  upsertConfig: db.upsertConfig,
  hasCapability,
  invalidateConfigCaches,
  invalidateGovernance: governance.invalidate,
  recordAdminAction,
});

router.use(requireJwtAuth, requireAdminAccess, configMiddleware);

router.get('/catalog', requireReadModels, handlers.catalog);
router.post('/policies', requireManageModels, handlers.createPolicy);
router.patch('/policies/:id', requireManageModels, handlers.updatePolicy);
router.delete('/policies/:id', requireManageModels, handlers.deletePolicy);
router.get('/providers', requireReadModels, handlers.listProviders);
router.put('/providers', requireManageModels, requireManageConfigs, handlers.updateProviders);

module.exports = router;
