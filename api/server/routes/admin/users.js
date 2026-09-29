const bcrypt = require('bcryptjs');
const express = require('express');
const mongoose = require('mongoose');
const {
  createAdminUsersHandlers,
  createAdminAccountsHandlers,
  revokeUserCodeEnvironmentWorkers,
} = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability, hasCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const {
  drainAgentTriggerDeliveriesForUser,
  prepareAgentTriggerUserPurge,
  cancelAgentTriggerUserPurge,
  purgeAgentTriggerDeliveriesForUser,
} = require('~/server/services/Agents/triggers');
const {
  resolveScope,
  getTenantConfig,
  recordAdminAction,
} = require('~/server/services/AdminPanel');
const { effectiveAccess } = require('./access');
const db = require('~/models');
const { getAppConfig, invalidateCodeEnvironmentConfigCache } = require('~/server/services/Config');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createAdminUsersHandlers({
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  beginAgentTriggerUserDeletion: db.beginAgentTriggerUserDeletion,
  cancelAgentTriggerUserDeletion: db.cancelAgentTriggerUserDeletion,
  drainAgentTriggerDeliveriesForUser,
  prepareAgentTriggerUserPurge,
  cancelAgentTriggerUserPurge,
  purgeAgentTriggerDeliveriesForUser,
  revokeUserCodeEnvironmentWorkers: async (userId) =>
    revokeUserCodeEnvironmentWorkers({
      mongoose,
      userId,
      appConfig: await getAppConfig({ baseOnly: true }),
    }),
  deleteUserById: db.deleteUserById,
  deleteUserCodeEnvironments: db.deleteUserCodeEnvironments,
  invalidateCodeEnvironmentConfigCache,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
});

const accounts = createAdminAccountsHandlers({
  resolveScope,
  hasCapability,
  listAdminUsers: db.listAdminUsers,
  findAdminUserById: db.findAdminUserById,
  listGroupsForUsers: db.listGroupsForUsers,
  getGroupMemberUserIds: db.getGroupMemberUserIds,
  isEmailTaken: async (email, excludeUserId) => {
    const user = await db.findUser({ email }, '_id');
    return user != null && user._id.toString() !== excludeUserId;
  },
  roleExists: async (name) => (await db.getRoleByName(name)) != null,
  groupExists: async (groupId) => (await db.findGroupById(groupId)) != null,
  countUsersByRole: db.countUsersByRole,
  createUser: db.createUser,
  updateUser: db.updateUser,
  addUserToGroup: db.addUserToGroup,
  removeUserFromGroup: db.removeUserFromGroup,
  deleteAllUserSessions: db.deleteAllUserSessions,
  hashPassword: (password) => bcrypt.hash(password, 10),
  getTenantConfig,
  recordAdminAction,
});

router.use(requireJwtAuth, requireAdminAccess);

/** Listing and reads are scope-checked: `read:users` sees everyone, `read:team` a manager's team. */
router.get('/', accounts.list);
router.get('/search', requireReadUsers, handlers.searchUsers);
router.post('/', requireManageUsers, accounts.create);
router.get('/:id', accounts.get);
router.patch('/:id', requireManageUsers, accounts.update);
router.patch('/:id/status', accounts.setStatus);
router.post('/:id/password', requireManageUsers, accounts.resetPassword);
router.get('/:id/effective-access', ...effectiveAccess);

module.exports = router;
