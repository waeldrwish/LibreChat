const express = require('express');
const { createAdminAccessHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { AccessRoleIds, ResourceType } = require('librechat-data-provider');
const { requireCapability, hasCapability } = require('~/server/middleware/roles/capabilities');
const { loadServedModels } = require('~/server/controllers/ModelController');
const { grantPermission } = require('~/server/services/PermissionService');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const { governance } = require('~/server/services/Governance');
const {
  resolveScope,
  getTenantConfig,
  recordAdminAction,
} = require('~/server/services/AdminPanel');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const principalLookups = {
  user: (id) => db.findAdminUserById(id),
  group: (id) => db.findGroupById(id),
  role: (id) => db.getRoleByName(id),
};

const principalNameResolvers = {
  user: async (ids) => {
    const { users } = await db.listAdminUsers({ userIds: ids, limit: ids.length, offset: 0 });
    return new Map(users.map((user) => [user._id, user.name || user.email]));
  },
  group: async (ids) => {
    const groups = await Promise.all(ids.map((id) => db.findGroupById(id, { name: 1 })));
    return new Map(groups.filter(Boolean).map((group) => [group._id.toString(), group.name]));
  },
  role: async (ids) => new Map(ids.map((id) => [id, id])),
};

const handlers = createAdminAccessHandlers({
  governance,
  resolveScope,
  hasCapability,
  principalExists: async (type, id) => (await principalLookups[type](id)) != null,
  findGovernanceSubject: async (userId) => {
    const user = await db.findAdminUserById(userId);
    return user
      ? {
          id: user._id,
          role: user.role,
          idOnTheSource: user.idOnTheSource ?? null,
          tenantId: user.tenantId,
        }
      : null;
  },
  getTenantConfig,
  loadAvailableModels: loadServedModels,
  listModelPolicies: db.listModelPolicies,
  setPrincipalModelGrants: db.setPrincipalModelGrants,
  findUsageLimitsForPrincipals: db.findUsageLimitsForPrincipals,
  setUsageLimits: db.setUsageLimits,
  listUsageLimits: db.listUsageLimits,
  resolvePrincipalNames: (type, ids) => principalNameResolvers[type](ids),
  listPrincipalAgentAccess: db.listPrincipalAgentAccess,
  findAgentRefs: db.findAgentRefs,
  grantAgentViewer: ({ principalType, principalId, resourceId, grantedBy }) =>
    grantPermission({
      principalType,
      principalId,
      resourceType: ResourceType.AGENT,
      resourceId,
      accessRoleId: AccessRoleIds.AGENT_VIEWER,
      grantedBy,
    }),
  revokeAgentAccess: ({ principalType, principalId, resourceId }) =>
    db.revokePermission(principalType, principalId, ResourceType.AGENT, resourceId),
  recordAdminAction,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/limits', handlers.listLimits);
router.get('/:principalType/:principalId', handlers.getAccess);
router.put('/:principalType/:principalId', handlers.updateAccess);

/** Mounted under `/api/admin/users/:id/effective-access` by the users router. */
const effectiveAccess = [configMiddleware, handlers.effective];

module.exports = router;
module.exports.effectiveAccess = effectiveAccess;
