const express = require('express');
const { createAdminAgentsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { recordAdminAction } = require('~/server/services/AdminPanel');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadAgents = requireCapability(SystemCapabilities.READ_AGENTS);
const requireManageAgents = requireCapability(SystemCapabilities.MANAGE_AGENTS);

const handlers = createAdminAgentsHandlers({
  listAdminAgents: db.listAdminAgents,
  setAgentDisabled: db.setAgentDisabled,
  summarizeAgentSharing: db.summarizeAgentSharing,
  recordAdminAction,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadAgents, handlers.list);
router.patch('/:id/status', requireManageAgents, handlers.setStatus);

module.exports = router;
