const express = require('express');
const { createAdminPanelHandlers, readAuthSettings } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const {
  requireCapability,
  getHeldCapabilities,
} = require('~/server/middleware/roles/capabilities');
const { loadAvailableModels } = require('~/server/controllers/ModelController');
const { invalidateConfigCaches } = require('~/server/services/Config');
const { governance } = require('~/server/services/Governance');
const { requireJwtAuth } = require('~/server/middleware');
const {
  resolveScope,
  getTenantConfig,
  recordAdminAction,
} = require('~/server/services/AdminPanel');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadConfigs = requireCapability(SystemCapabilities.READ_CONFIGS);
const requireManageConfigs = requireCapability(SystemCapabilities.MANAGE_CONFIGS);

const handlers = createAdminPanelHandlers({
  getHeldCapabilities,
  resolveScope,
  getTenantConfig,
  loadAvailableModels,
  listModelPolicies: db.listModelPolicies,
  countAdminUsers: db.countAdminUsers,
  countAdminAgents: db.countAdminAgents,
  getUsageTotals: db.getUsageTotals,
  getUsageSeries: db.getUsageSeries,
  getUsageByModel: db.getUsageByModel,
  getUsageByUser: db.getUsageByUser,
  findConfigByPrincipal: db.findConfigByPrincipal,
  patchConfigFields: db.patchConfigFields,
  invalidateConfigCaches,
  invalidateGovernance: governance.invalidate,
  getAuthSettings: (appConfig) => readAuthSettings(process.env, appConfig),
  recordAdminAction,
});

/** Any signed-in user may ask whether the panel is theirs to open. */
router.get('/session', requireJwtAuth, handlers.session);

router.use(requireJwtAuth, requireAdminAccess);

router.get('/overview', handlers.overview);
router.get('/settings', requireReadConfigs, handlers.getSettings);
router.put('/settings', requireManageConfigs, handlers.updateSettings);

module.exports = router;
