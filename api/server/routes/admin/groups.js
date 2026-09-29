const express = require('express');
const {
  createAuditTrail,
  groupAuditRules,
  createAdminGroupsHandlers,
  createAdminTeamHandlers,
} = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { recordAdminAction } = require('~/server/services/AdminPanel');
const { governance } = require('~/server/services/Governance');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadGroups = requireCapability(SystemCapabilities.READ_GROUPS);
const requireManageGroups = requireCapability(SystemCapabilities.MANAGE_GROUPS);

const handlers = createAdminGroupsHandlers({
  listGroups: db.listGroups,
  countGroups: db.countGroups,
  findGroupById: db.findGroupById,
  createGroup: db.createGroup,
  updateGroupById: db.updateGroupById,
  deleteGroup: db.deleteGroup,
  addUserToGroup: db.addUserToGroup,
  removeUserFromGroup: db.removeUserFromGroup,
  removeMemberById: db.removeMemberById,
  findUsers: db.findUsers,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
  deletePrincipalGovernance: async (principalType, principalId) => {
    await db.deletePrincipalGovernance(principalType, principalId);
    governance.invalidate();
  },
});

const teams = createAdminTeamHandlers({
  setGroupManagers: db.setGroupManagers,
  findAdminUserById: db.findAdminUserById,
  recordAdminAction,
});

router.use(
  requireJwtAuth,
  requireAdminAccess,
  createAuditTrail(recordAdminAction, groupAuditRules),
);

router.get('/', requireReadGroups, handlers.listGroups);
router.post('/', requireManageGroups, handlers.createGroup);
router.get('/:id', requireReadGroups, handlers.getGroup);
router.patch('/:id', requireManageGroups, handlers.updateGroup);
router.delete('/:id', requireManageGroups, handlers.deleteGroup);
router.put('/:id/managers', requireManageGroups, teams.setManagers);
router.get('/:id/members', requireReadGroups, handlers.getGroupMembers);
router.post('/:id/members', requireManageGroups, handlers.addGroupMember);
router.delete('/:id/members/:userId', requireManageGroups, handlers.removeGroupMember);

module.exports = router;
