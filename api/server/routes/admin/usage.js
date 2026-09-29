const express = require('express');
const { createAdminUsageHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { resolveScope } = require('~/server/services/AdminPanel');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

/** Global usage requires `read:usage`; managers see their team through `read:team` (scope-checked). */
const handlers = createAdminUsageHandlers({
  resolveScope,
  getGroupMemberUserIds: db.getGroupMemberUserIds,
  getUsageTotals: db.getUsageTotals,
  getUsageSeries: db.getUsageSeries,
  getUsageByModel: db.getUsageByModel,
  getUsageByUser: db.getUsageByUser,
  getUsageByAgent: db.getUsageByAgent,
  findAgentConversationIds: db.findAgentConversationIds,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', handlers.report);

module.exports = router;
