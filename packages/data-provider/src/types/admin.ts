import type {
  TUsageLimits,
  TModelPolicy,
  TAccessSource,
  UsageLimitMetric,
  TGovernanceConfig,
  AccessPrincipalType,
} from '../governance';
import type { TRole } from '../roles';

/* ── Audit log taxonomy ─────────────────────────────────────────────── */

/**
 * High-level domains an audit entry can belong to. The audit log is a
 * general-purpose, append-only compliance record; new domains are added here as
 * the surface grows, without reshaping the record.
 */
export const AUDIT_CATEGORIES = [
  'grant',
  'agent_run',
  'tool_call',
  'mcp',
  'config',
  'permission',
  'auth',
  'approval',
  'user',
  'group',
  'role',
  'model',
  'agent',
  'usage',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/**
 * Single source of truth for the audit-action enum. Actions are namespaced
 * `<category>.<verb>` so the registry stays readable as it grows and every
 * action maps unambiguously to a category. The Mongoose schema enum and the
 * HTTP handler's whitelist both consume this constant so they cannot drift.
 */
export const AUDIT_ACTIONS = [
  'grant.assigned',
  'grant.removed',
  'permission.insights_assigned',
  'permission.insights_removed',
  'permission.access_updated',
  'config.updated',
  'config.deleted',
  'user.created',
  'user.updated',
  'user.disabled',
  'user.enabled',
  'user.password_reset',
  'group.created',
  'group.updated',
  'group.deleted',
  'group.member_added',
  'group.member_removed',
  'role.created',
  'role.updated',
  'role.deleted',
  'role.permissions_updated',
  'role.member_added',
  'role.member_removed',
  'model.policy_created',
  'model.policy_updated',
  'model.policy_deleted',
  'agent.enabled',
  'agent.disabled',
  'agent.access_updated',
  'agent.deleted',
  'usage.limits_updated',
  'usage.limit_exceeded',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Maps each action to its category so writers never pass both. */
export const AUDIT_ACTION_CATEGORY: Record<AuditAction, AuditCategory> = {
  'grant.assigned': 'grant',
  'grant.removed': 'grant',
  'permission.insights_assigned': 'permission',
  'permission.insights_removed': 'permission',
  'permission.access_updated': 'permission',
  'config.updated': 'config',
  'config.deleted': 'config',
  'user.created': 'user',
  'user.updated': 'user',
  'user.disabled': 'user',
  'user.enabled': 'user',
  'user.password_reset': 'user',
  'group.created': 'group',
  'group.updated': 'group',
  'group.deleted': 'group',
  'group.member_added': 'group',
  'group.member_removed': 'group',
  'role.created': 'role',
  'role.updated': 'role',
  'role.deleted': 'role',
  'role.permissions_updated': 'role',
  'role.member_added': 'role',
  'role.member_removed': 'role',
  'model.policy_created': 'model',
  'model.policy_updated': 'model',
  'model.policy_deleted': 'model',
  'agent.enabled': 'agent',
  'agent.disabled': 'agent',
  'agent.access_updated': 'agent',
  'agent.deleted': 'agent',
  'usage.limits_updated': 'usage',
  'usage.limit_exceeded': 'usage',
};

/** Result of the audited operation. Kept first-class instead of being encoded
 * into the action so `allowed` vs `denied` vs `failed` is queryable. */
export const AUDIT_OUTCOMES = ['success', 'failure', 'denied', 'pending'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Coarse severity for SIEM routing and alerting. */
export const AUDIT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

/**
 * Who initiated the action. Non-human actors are first-class: a scheduled job,
 * an agent acting autonomously, an internal service, or a webhook are all
 * representable without forcing a `User` id.
 */
export const AUDIT_ACTOR_TYPES = [
  'user',
  'system',
  'agent',
  'service',
  'schedule',
  'webhook',
  'api',
] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** Primitive metadata values; event-specific payload is a flat string-keyed map
 * (e.g. `{ capability }` for grants, `{ runId, triggerType }` for agent runs). */
export type AuditMetadataValue = string | number | boolean | null;
export type AuditMetadata = Record<string, AuditMetadataValue>;

/** Denormalized actor identity captured at write time. */
export type AuditActor = {
  type: AuditActorType;
  /** Stable id (user id, service-account id, agent id); absent for anonymous
   * system events. */
  id?: string;
  /** Display name captured at write time so the record stays readable after the
   * underlying principal is renamed or deleted. */
  name: string;
};

/** Generic target of the action — not principal-locked, so it can describe a
 * role, agent, MCP server, config section, etc. */
export type AuditTarget = {
  type: string;
  id?: string;
  name?: string;
};

/** Request context for forensic joins and SIEM correlation. */
export type AuditContext = {
  /** Correlation id (`x-request-id` / `x-correlation-id`). */
  requestId?: string;
  ip?: string;
  userAgent?: string;
  sessionId?: string;
};

/** Per-entry tamper-evidence surfaced to readers. The full chain is verifiable
 * via the verify endpoint. */
export type AuditIntegrity = {
  /** Monotonic per-chain sequence number (1-based). */
  seq: number;
  /** SHA-256 of this entry's canonical content linked to `prevHash`. */
  hash: string;
  /** Hash of the previous entry in the chain (genesis links to a zero hash). */
  prevHash: string;
};

/** Audit log entry as returned by the admin API. */
export type AdminAuditLogEntry = {
  id: string;
  schemaVersion: number;
  category: AuditCategory;
  action: AuditAction;
  outcome: AuditOutcome;
  severity: AuditSeverity;
  actor: AuditActor;
  target: AuditTarget;
  metadata?: AuditMetadata;
  context?: AuditContext;
  /** Absent = platform-operator entry; present = tenant-scoped entry. */
  tenantId?: string;
  integrity: AuditIntegrity;
  /** `createdAt` as an ISO 8601 string. */
  timestamp: string;
};

export type TAdminAuditLogPage = {
  entries: AdminAuditLogEntry[];
  total: number;
  nextCursor: number | null;
};

export type TAdminAuditLogParams = {
  search?: string;
  category?: AuditCategory;
  action?: AuditAction;
  outcome?: AuditOutcome;
  actorQuery?: string;
  targetQuery?: string;
  from?: string;
  to?: string;
  cursor?: number;
  limit?: number;
};

/* ── Existing admin resources ───────────────────────────────────────── */

/** Group as returned by the admin API. */
export type AdminGroup = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  topMembers: { name: string }[];
  isActive: boolean;
};

/** Member entry as returned by the admin API for group/role membership lists. */
export type AdminMember = {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  joinedAt?: string;
};

/** Full user info returned by the admin user list endpoint. */
export type AdminUserListItem = {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  role: string;
  provider: string;
  disabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** Minimal user info returned by user search endpoints. */
export type AdminUserSearchResult = {
  id: string;
  name: string;
  email: string;
  username?: string;
  avatarUrl?: string;
};

export type TAdminRole = {
  _id?: string;
  name: string;
  description?: string;
  permissions: TRole['permissions'];
};

export type TAdminPage<K extends string, T> = { [key in K]: T[] } & {
  total: number;
  limit: number;
  offset: number;
};

/** Group document as the admin groups endpoints return it. */
export type TAdminGroupRecord = {
  _id: string;
  name: string;
  description?: string;
  email?: string;
  /** User ids, or `idOnTheSource` values for externally synced users. */
  memberIds?: string[];
  managerIds?: string[];
  source: 'local' | 'entra';
  idOnTheSource?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TAdminRolesPage = TAdminPage<'roles', Pick<TAdminRole, '_id' | 'name' | 'description'>>;
export type TAdminGroupsPage = TAdminPage<'groups', TAdminGroupRecord>;
export type TAdminMembersPage = TAdminPage<'members', AdminMember>;

/* ── Admin panel session ────────────────────────────────────────────── */

/** `global` administrators see everyone; `team` managers see the members of groups they manage. */
export type TAdminScope = 'global' | 'team' | 'none';

export type TAdminSession = {
  enabled: boolean;
  access: boolean;
  scope: TAdminScope;
  capabilities: string[];
  /** Locale the panel renders in (resolved from `governance.adminPanel.language`). */
  language: string;
};

/* ── Users ──────────────────────────────────────────────────────────── */

export type TAdminUserStatus = 'active' | 'disabled';

export type TAdminUserParams = {
  search?: string;
  role?: string;
  groupId?: string;
  status?: TAdminUserStatus;
  limit?: number;
  offset?: number;
};

export type TAdminUser = AdminUserListItem & {
  emailVerified?: boolean;
  disabledAt?: string;
  groups: { id: string; name: string }[];
};

export type TAdminUsersPage = TAdminPage<'users', TAdminUser>;

export type TAdminCreateUserRequest = {
  name: string;
  email: string;
  username?: string;
  password: string;
  role?: string;
  groupIds?: string[];
  disabled?: boolean;
};

export type TAdminUpdateUserRequest = {
  name?: string;
  username?: string;
  email?: string;
  role?: string;
  groupIds?: string[];
};

/* ── Principal access (models, agents, limits) ──────────────────────── */

export type TPrincipalAccess = {
  principalType: AccessPrincipalType;
  principalId: string;
  /** `endpoint|model` keys explicitly allowed at this level. */
  allowedModels: string[];
  /** `endpoint|model` keys explicitly denied at this level. */
  deniedModels: string[];
  /** Agent ids (`agent_...`) shared with this principal. */
  agentIds: string[];
  limits: TUsageLimits;
};

export type TPrincipalAccessUpdate = Partial<
  Pick<TPrincipalAccess, 'allowedModels' | 'deniedModels' | 'agentIds' | 'limits'>
>;

export type TEffectiveModel = {
  endpoint: string;
  model: string;
  allowed: boolean;
  source: TAccessSource;
};

export type TEffectiveLimit = {
  metric: UsageLimitMetric;
  /** `null` is unlimited. */
  limit: number | null;
  used: number;
  source: TAccessSource;
};

export type TEffectiveAccess = {
  models: TEffectiveModel[];
  limits: TEffectiveLimit[];
};

/* ── Models ─────────────────────────────────────────────────────────── */

export type TModelCatalogEntry = {
  endpoint: string;
  model: string;
  /** Whether a configured provider currently lists this model. */
  available: boolean;
  policy?: TModelPolicy;
};

export type TModelCatalog = {
  defaultPolicy: 'allow' | 'deny';
  endpoints: string[];
  entries: TModelCatalogEntry[];
  /** Endpoint-wide (`model: '*'`) policies. */
  endpointPolicies: TModelPolicy[];
};

/** A built-in provider (OpenAI, Anthropic, …) configured through the environment. */
export type TBuiltInProvider = {
  name: string;
  enabled: boolean;
  userProvide: boolean;
  models: number;
};

/** A custom OpenAI-compatible provider defined in `librechat.yaml` (read-only here). */
export type TConfiguredProvider = {
  name: string;
  baseURL?: string;
  models: number;
  fetch: boolean;
};

/** A custom OpenAI-compatible provider managed from the admin panel. */
export type TManagedProvider = {
  name: string;
  baseURL: string;
  /** Write-only: omit to keep the stored key, send `''` to clear it. */
  apiKey?: string;
  /** Masked preview of the stored key, returned on reads. */
  apiKeyPreview?: string;
  models: { default: string[]; fetch?: boolean };
  titleConvo?: boolean;
  titleModel?: string;
  modelDisplayLabel?: string;
  iconURL?: string;
};

export type TProviders = {
  builtIn: TBuiltInProvider[];
  configured: TConfiguredProvider[];
  managed: TManagedProvider[];
  /** Whether the viewer may change managed providers. */
  canManage: boolean;
};

/* ── Agents ─────────────────────────────────────────────────────────── */

export type TAdminAgent = {
  _id: string;
  id: string;
  name: string;
  description?: string;
  provider?: string;
  model?: string;
  author?: string;
  authorName?: string;
  category?: string;
  disabled: boolean;
  avatar?: { filepath?: string; source?: string } | null;
  toolCount: number;
  sharedWith: number;
  isPublic: boolean;
  updatedAt?: string;
};

export type TAdminAgentsParams = {
  search?: string;
  status?: 'enabled' | 'disabled';
  limit?: number;
  offset?: number;
};

export type TAdminAgentsPage = TAdminPage<'agents', TAdminAgent>;

/* ── Usage ──────────────────────────────────────────────────────────── */

export type TUsageGranularity = 'day' | 'month';

export type TUsageParams = {
  from: string;
  to: string;
  userId?: string;
  groupId?: string;
  model?: string;
  agentId?: string;
  unit?: TUsageGranularity;
  timeZone?: string;
};

export type TUsageTotals = {
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  /** USD, derived from the priced token value of each transaction. */
  cost: number;
  messages: number;
  conversations: number;
  activeUsers: number;
  requests: number;
};

export type TUsagePoint = {
  date: string;
  tokens: number;
  cost: number;
  messages: number;
};

export type TUsageByModel = {
  model: string;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  requests: number;
};

export type TUsageByUser = {
  userId: string;
  name: string;
  email: string;
  tokens: number;
  cost: number;
  messages: number;
};

export type TUsageByAgent = {
  agentId: string;
  name: string;
  conversations: number;
  tokens: number;
  cost: number;
};

export type TUsageReport = {
  totals: TUsageTotals;
  series: TUsagePoint[];
  byModel: TUsageByModel[];
  byUser: TUsageByUser[];
  byAgent: TUsageByAgent[];
};

export type TAdminOverview = {
  users: { total: number; active: number; disabled: number };
  models: { active: number; policies: number };
  agents: { total: number; disabled: number };
  today: TUsageTotals;
  month: TUsageTotals;
  topModels: TUsageByModel[];
  topUsers: TUsageByUser[];
  series: TUsagePoint[];
};

/* ── Groups, grants, settings ───────────────────────────────────────── */

export type TAdminGroupInput = {
  name: string;
  description?: string;
  email?: string;
  memberIds?: string[];
};

export type TAdminGrant = {
  principalType: string;
  principalId: string;
  capability: string;
  grantedAt?: string;
};

/** Deployment facts the settings page shows read-only (they come from the environment). */
export type TAdminAuthSettings = {
  emailLoginEnabled: boolean;
  registrationEnabled: boolean;
  passwordResetEnabled: boolean;
  socialLogins: string[];
  openidEnabled: boolean;
  samlEnabled: boolean;
  ldapEnabled: boolean;
};

export type TAdminSettings = {
  governance: TGovernanceConfig;
  auth: TAdminAuthSettings;
  balance: { enabled: boolean; startBalance?: number };
  transactions: { enabled: boolean };
};

/* ── Usage limits ───────────────────────────────────────────────────── */

export type TUsageLimitEntry = {
  principalType: AccessPrincipalType;
  principalId: string;
  principalName?: string;
  limits: TUsageLimits;
  updatedAt?: string;
};

/** Payload of a `usage_limit` chat error. */
export type TUsageLimitError = {
  type: 'usage_limit';
  metric: UsageLimitMetric;
  limit: number;
  used: number;
  /** ISO timestamp when the window resets. */
  resetAt: string;
};
