const express = require('express');
const { encrypt, filterUniquePlugins, createAdminToolsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability, hasCapability } = require('~/server/middleware/roles/capabilities');
const { getTenantConfig, recordAdminAction } = require('~/server/services/AdminPanel');
const { invalidateConfigCaches } = require('~/server/services/Config');
const { availableTools } = require('~/app/clients/tools');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadConfigs = requireCapability(SystemCapabilities.READ_CONFIGS);
const requireManageConfigs = requireCapability(SystemCapabilities.MANAGE_CONFIGS);

const handlers = createAdminToolsHandlers({
  listTools: () => filterUniquePlugins(availableTools),
  getTenantConfig,
  findConfigByPrincipal: db.findConfigByPrincipal,
  upsertConfig: db.upsertConfig,
  invalidateConfigCaches,
  findPluginAuthsByKeys: db.findPluginAuthsByKeys,
  updatePluginAuth: db.updatePluginAuth,
  deletePluginAuth: db.deletePluginAuth,
  encrypt,
  env: process.env,
  hasCapability,
  recordAdminAction,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadConfigs, handlers.list);
router.patch('/:key', requireManageConfigs, handlers.update);

module.exports = router;
