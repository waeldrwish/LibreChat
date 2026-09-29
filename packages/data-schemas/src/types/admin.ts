import type { PrincipalType, PrincipalModel, TCustomConfig } from 'librechat-data-provider';

/* ── Capability types (defined alongside the SystemCapabilities constant) ── */

export type {
  BaseSystemCapability,
  ConfigAssignTarget,
  ConfigSection,
  SystemCapability,
  CapabilityCategory,
} from '~/admin/capabilities';

/* ── Admin API response types ───────────────────────────────────────── */

/** Config document as returned by the admin API (no Mongoose internals). */
export type AdminConfig = {
  _id: string;
  principalType: PrincipalType;
  principalId: string;
  principalModel: PrincipalModel;
  priority: number;
  overrides: Partial<TCustomConfig>;
  isActive: boolean;
  configVersion: number;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminConfigListResponse = {
  configs: AdminConfig[];
};

export type AdminConfigResponse = {
  config: AdminConfig;
};

export type AdminConfigDeleteResponse = {
  success: boolean;
};

/* ── Audit log taxonomy and shared admin DTOs ───────────────────────── */

/**
 * The audit taxonomy and the admin DTOs are shared with the in-app admin panel,
 * so their single definition lives in `librechat-data-provider`.
 */
export {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
  AUDIT_ACTOR_TYPES,
  AUDIT_ACTION_CATEGORY,
} from 'librechat-data-provider';

export type {
  AuditActor,
  AdminGroup,
  AuditAction,
  AuditTarget,
  AdminMember,
  AuditContext,
  AuditOutcome,
  AuditCategory,
  AuditSeverity,
  AuditMetadata,
  AuditActorType,
  AuditIntegrity,
  AdminAuditLogEntry,
  AuditMetadataValue,
  AdminUserListItem,
  AdminUserSearchResult,
} from 'librechat-data-provider';

/** SystemGrant document as returned by the admin API. */
export type AdminSystemGrant = {
  id: string;
  principalType: PrincipalType;
  principalId: string;
  capability: string;
  grantedBy?: string;
  grantedAt: string;
  expiresAt?: string;
};
