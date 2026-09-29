const { createAdminAuditRecorder, createAdminScopeResolver } = require('@librechat/api');
const { getHeldCapabilities } = require('~/server/middleware/roles/capabilities');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');

/** Records administrative actions in the hash-chained audit log. */
const recordAdminAction = createAdminAuditRecorder(db.recordAuditEntry);

/** Resolves whether an administrator sees everyone or only the members of groups they manage. */
const resolveScope = createAdminScopeResolver({
  getHeldCapabilities,
  findManagedGroupIds: db.findManagedGroupIds,
  getGroupMemberUserIds: db.getGroupMemberUserIds,
});

/** The tenant-wide config: `librechat.yaml` merged with the base config stored by admins. */
const getTenantConfig = (tenantId) => getAppConfig(tenantId ? { tenantId } : {});

/** The `librechat.yaml`-derived config only. */
const getYamlConfig = () => getAppConfig({ baseOnly: true });

module.exports = { recordAdminAction, resolveScope, getTenantConfig, getYamlConfig };
