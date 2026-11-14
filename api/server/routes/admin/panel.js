const express = require('express');
const { hashSecret, createAdminPanelHandlers, createAdminAuditEmitter } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');

/**
 * Admin panel API (`/api/admin/panel`): account provisioning, balances and spend
 * reporting. Behavior lives in `packages/api` (`createAdminPanelHandlers`); this file
 * only wires the database methods and capability gates.
 */

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);
const requireReadUsage = requireCapability(SystemCapabilities.READ_USAGE);

const handlers = createAdminPanelHandlers({
  countUsers: db.countUsers,
  findUsersByIds: (ids) => db.findUsers({ _id: { $in: ids } }, '_id email username name'),
  findUserIdByEmail: async (email) => {
    const user = await db.findUser({ email }, '_id');
    return user ? String(user._id) : null;
  },
  createUser: (data, balanceConfig) => db.createUser(data, balanceConfig, true, true),
  getAppBalanceConfig: async (role) => (await getAppConfig({ role }))?.balance,
  hashPassword: hashSecret,
  findBalance: db.findBalanceByUser,
  upsertBalance: db.upsertBalanceFields,
  aggregateSpend: db.aggregateSpend,
  emitAudit: createAdminAuditEmitter({
    recordAuditEntry: db.recordAuditEntry,
    failClosed: process.env.AUDIT_LOG_FAIL_CLOSED === 'true',
    logPrefix: '[adminPanel]',
  }),
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/summary', requireReadUsage, handlers.summary);
router.get('/usage', requireReadUsage, handlers.usage);
router.post('/users', requireManageUsers, handlers.createUser);
router.get('/users/:id/balance', requireReadUsers, handlers.getBalance);
router.put('/users/:id/balance', requireManageUsers, handlers.updateBalance);

module.exports = router;
