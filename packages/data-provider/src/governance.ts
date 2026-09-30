import { z } from 'zod';
import { EModelEndpoint } from './schemas';

/**
 * Governance: the organization-level policy layer an administrator manages from the
 * in-app admin panel — which models a principal may use, how much a principal may
 * consume, and how the panel itself is presented.
 */

/** Sentinel for `governance.adminPanel.language` meaning "follow the viewer's own language". */
export const ADMIN_PANEL_LANGUAGE_USER = 'user';

/** Stored limit value meaning "explicitly unlimited" (overrides an inherited limit). */
export const UNLIMITED_USAGE = -1;

export const USAGE_LIMIT_METRICS = [
  'tokensPerDay',
  'tokensPerMonth',
  'messagesPerDay',
  'messagesPerMonth',
] as const;

export type UsageLimitMetric = (typeof USAGE_LIMIT_METRICS)[number];

/** `undefined` inherits, `-1` is unlimited, `0` blocks, a positive integer caps usage. */
export type TUsageLimits = Partial<Record<UsageLimitMetric, number>>;

const usageLimitValueSchema = z.number().int().min(UNLIMITED_USAGE).max(Number.MAX_SAFE_INTEGER);

export const usageLimitsSchema = z
  .object({
    tokensPerDay: usageLimitValueSchema.optional(),
    tokensPerMonth: usageLimitValueSchema.optional(),
    messagesPerDay: usageLimitValueSchema.optional(),
    messagesPerMonth: usageLimitValueSchema.optional(),
  })
  .strict();

export const MODEL_ACCESS_POLICIES = ['allow', 'deny'] as const;
export type ModelAccessPolicy = (typeof MODEL_ACCESS_POLICIES)[number];

export const governanceSchema = z.object({
  adminPanel: z
    .object({
      /** Serves the in-app admin panel to principals holding `access:admin`. */
      enabled: z.boolean().default(true),
      /** Locale the panel renders in, or `user` to follow the viewer's language. */
      language: z.string().min(2).max(16).default('ar'),
    })
    .default({}),
  models: z
    .object({
      /**
       * Applies to models without an admin policy. `allow` keeps every discovered model
       * available (LibreChat's default behavior); `deny` hides anything not explicitly
       * granted through a model policy.
       */
      defaultPolicy: z.enum(MODEL_ACCESS_POLICIES).default('allow'),
    })
    .default({}),
  limits: z
    .object({
      /** Enforces user/group/role usage limits on chat requests. */
      enabled: z.boolean().default(true),
      /** Limits applied when no user, group or role limit is set. Empty means unlimited. */
      defaults: usageLimitsSchema.default({}),
      /** IANA time zone whose midnight starts a new day/month window. */
      timeZone: z.string().min(1).max(64).default('UTC'),
    })
    .default({}),
  /** Seconds a process caches model policies and usage limits before re-reading them. */
  policyCacheSeconds: z.number().int().min(0).max(3600).default(15),
  /** Seconds a user's consumed usage is cached between limit checks. */
  usageCacheSeconds: z.number().int().min(0).max(600).default(10),
});

export type TGovernanceConfig = z.infer<typeof governanceSchema>;

/** Resolves a (possibly partial or invalid) governance section to a complete config. */
export function resolveGovernanceConfig(value: unknown): TGovernanceConfig {
  const parsed = governanceSchema.safeParse(value ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  return governanceSchema.parse({});
}

/* ── Model policies ─────────────────────────────────────────────────── */

/** Matches every model of an endpoint when used as a policy's `model`. */
export const ANY_MODEL = '*';

const RESERVED_ENDPOINT_NAMES = new Set(
  Object.values(EModelEndpoint).map((name) => name.toLowerCase()),
);

/**
 * A managed provider cannot take a built-in endpoint's name in any casing: provider
 * resolution falls back to a lowercase match, so `Anthropic` would route to the built-in.
 */
export function isReservedEndpointName(name: string): boolean {
  return RESERVED_ENDPOINT_NAMES.has(name.trim().toLowerCase());
}

export const MODEL_GRANT_PRINCIPALS = ['user', 'group', 'role', 'agent'] as const;
export type ModelGrantPrincipal = (typeof MODEL_GRANT_PRINCIPALS)[number];

export const MODEL_GRANT_EFFECTS = ['allow', 'deny'] as const;
export type ModelGrantEffect = (typeof MODEL_GRANT_EFFECTS)[number];

/**
 * Who a policy admits when no grant decides: `inherit` defers to the endpoint-wide
 * policy (or `governance.models.defaultPolicy`), `all` admits everyone not denied,
 * `restricted` admits only principals with an `allow` grant.
 */
export const MODEL_POLICY_ACCESS = ['inherit', 'all', 'restricted'] as const;
export type ModelPolicyAccess = (typeof MODEL_POLICY_ACCESS)[number];

export type TModelGrant = {
  principalType: ModelGrantPrincipal;
  principalId: string;
  /** Agents can only be allowed: an agent grant delegates the model to the agent's users. */
  effect: ModelGrantEffect;
};

export type TModelPolicy = {
  id: string;
  endpoint: string;
  model: string;
  label?: string;
  description?: string;
  enabled: boolean;
  access: ModelPolicyAccess;
  /** Caps the output tokens requested from this model; unset leaves the request as is. */
  maxOutputTokens?: number;
  grants: TModelGrant[];
  createdAt?: string;
  updatedAt?: string;
};

export type TModelPolicyInput = Omit<TModelPolicy, 'id' | 'createdAt' | 'updatedAt'>;

/** `maxOutputTokens: null` removes the cap. */
export type TModelPolicyUpdate = Partial<
  Omit<TModelPolicyInput, 'endpoint' | 'model' | 'maxOutputTokens'>
> & {
  maxOutputTokens?: number | null;
};

/** Stable key for a model within an endpoint: `endpoint|model`. */
export function modelKey(endpoint: string, model: string): string {
  return `${endpoint}|${model}`;
}

export function parseModelKey(key: string): { endpoint: string; model: string } | null {
  const index = key.indexOf('|');
  if (index <= 0 || index === key.length - 1) {
    return null;
  }
  return { endpoint: key.slice(0, index), model: key.slice(index + 1) };
}

/* ── Principal precedence ───────────────────────────────────────────── */

/** Where an effective setting came from, most specific first. */
export type TAccessSource = 'user' | 'group' | 'role' | 'policy' | 'default';

export const ACCESS_PRINCIPAL_TYPES = ['user', 'group', 'role'] as const;
export type AccessPrincipalType = (typeof ACCESS_PRINCIPAL_TYPES)[number];
