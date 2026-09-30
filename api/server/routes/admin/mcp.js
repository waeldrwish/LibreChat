const express = require('express');
const { createAdminMCPHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { getYamlConfig } = require('~/server/services/AdminPanel');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireManageMCP = requireCapability(SystemCapabilities.MANAGE_MCP_SERVERS);

const handlers = createAdminMCPHandlers({
  listAdminMCPServers: db.listAdminMCPServers,
  summarizeMCPServerSharing: db.summarizeMCPServerSharing,
  getYamlConfig,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireManageMCP, handlers.list);

module.exports = router;
