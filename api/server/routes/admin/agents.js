const express = require('express');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { createAdminAgentsHandlers, createAdminAgentPolicyHandlers } = require('@librechat/api');
const { requireCapability, hasCapability } = require('~/server/middleware/roles/capabilities');
const { recordAdminAction } = require('~/server/services/AdminPanel');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadAgents = requireCapability(SystemCapabilities.READ_AGENTS);
const requireManageAgents = requireCapability(SystemCapabilities.MANAGE_AGENTS);
const requireManageRoles = requireCapability(SystemCapabilities.MANAGE_ROLES);

const handlers = createAdminAgentsHandlers({
  listAdminAgents: db.listAdminAgents,
  setAgentDisabled: db.setAgentDisabled,
  summarizeAgentSharing: db.summarizeAgentSharing,
  recordAdminAction,
});

const policy = createAdminAgentPolicyHandlers({
  listRoles: db.listRoles,
  getRoleByName: db.getRoleByName,
  updateAccessPermissions: db.updateAccessPermissions,
  hasCapability,
  recordAdminAction,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadAgents, handlers.list);
router.get('/policy', requireReadAgents, policy.get);
router.put('/policy', requireManageAgents, requireManageRoles, policy.update);
router.patch('/:id/status', requireManageAgents, handlers.setStatus);

module.exports = router;
