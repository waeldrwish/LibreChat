const express = require('express');
const { createAdminSectionsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability, hasCapability } = require('~/server/middleware/roles/capabilities');
const { getTenantConfig, recordAdminAction } = require('~/server/services/AdminPanel');
const { invalidateConfigCaches } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadRoles = requireCapability(SystemCapabilities.READ_ROLES);
const requireManageRoles = requireCapability(SystemCapabilities.MANAGE_ROLES);

const handlers = createAdminSectionsHandlers({
  listRoles: db.listRoles,
  getRoleByName: db.getRoleByName,
  updateAccessPermissions: db.updateAccessPermissions,
  getTenantConfig,
  findConfigByPrincipal: db.findConfigByPrincipal,
  upsertConfig: db.upsertConfig,
  invalidateConfigCaches,
  hasCapability,
  recordAdminAction,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadRoles, handlers.list);
router.patch('/:role', requireManageRoles, handlers.update);

module.exports = router;
