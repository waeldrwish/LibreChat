import { UNLIMITED_USAGE, USAGE_LIMIT_METRICS } from 'librechat-data-provider';
import type {
  TUsageLimits,
  TAccessSource,
  TEffectiveLimit,
  UsageLimitMetric,
} from 'librechat-data-provider';
import type { UsageLimitRecord, UserUsageSnapshot } from '@librechat/data-schemas';
import type { PrincipalSet } from './principals';
import type { UsagePeriods } from './periods';

/** `limit: null` is unlimited. */
export type ResolvedLimit = { limit: number | null; source: TAccessSource };
export type ResolvedLimits = Record<UsageLimitMetric, ResolvedLimit>;

export type LimitExceeded = {
  metric: UsageLimitMetric;
  limit: number;
  used: number;
  resetAt: Date;
};

const toLimit = (value: number): number | null => (value === UNLIMITED_USAGE ? null : value);

/** The more generous of two limits; unlimited (`null`) beats any number. */
function moreGenerous(a: number | null | undefined, b: number | null): number | null {
  if (a === undefined) {
    return b;
  }
  if (a === null || b === null) {
    return null;
  }
  return Math.max(a, b);
}

/**
 * Resolves each metric independently by precedence: the user's own limit, else the
 * most generous limit among their groups, else their role's limit, else the
 * configured default, else unlimited.
 */
export function resolveEffectiveLimits(
  principals: PrincipalSet,
  records: UsageLimitRecord[],
  defaults: TUsageLimits,
): ResolvedLimits {
  const userLimits: TUsageLimits[] = [];
  const groupLimits: TUsageLimits[] = [];
  const roleLimits: TUsageLimits[] = [];
  const groupIds = new Set(principals.groupIds);
  for (const record of records) {
    if (record.principalType === 'user' && record.principalId === principals.userId) {
      userLimits.push(record.limits);
    } else if (record.principalType === 'group' && groupIds.has(record.principalId)) {
      groupLimits.push(record.limits);
    } else if (record.principalType === 'role' && record.principalId === principals.role) {
      roleLimits.push(record.limits);
    }
  }

  const resolved = {} as ResolvedLimits;
  for (const metric of USAGE_LIMIT_METRICS) {
    resolved[metric] = resolveMetric(metric, userLimits, groupLimits, roleLimits, defaults);
  }
  return resolved;
}

function resolveMetric(
  metric: UsageLimitMetric,
  userLimits: TUsageLimits[],
  groupLimits: TUsageLimits[],
  roleLimits: TUsageLimits[],
  defaults: TUsageLimits,
): ResolvedLimit {
  const userValue = userLimits.find((limits) => limits[metric] != null)?.[metric];
  if (userValue != null) {
    return { limit: toLimit(userValue), source: 'user' };
  }

  let groupValue: number | null | undefined;
  for (const limits of groupLimits) {
    const value = limits[metric];
    if (value != null) {
      groupValue = moreGenerous(groupValue, toLimit(value));
    }
  }
  if (groupValue !== undefined) {
    return { limit: groupValue, source: 'group' };
  }

  const roleValue = roleLimits.find((limits) => limits[metric] != null)?.[metric];
  if (roleValue != null) {
    return { limit: toLimit(roleValue), source: 'role' };
  }

  const defaultValue = defaults[metric];
  if (defaultValue != null) {
    return { limit: toLimit(defaultValue), source: 'default' };
  }
  return { limit: null, source: 'default' };
}

export const hasAnyLimit = (limits: ResolvedLimits): boolean =>
  USAGE_LIMIT_METRICS.some((metric) => limits[metric].limit !== null);

const usedFor = (metric: UsageLimitMetric, usage: UserUsageSnapshot): number => {
  switch (metric) {
    case 'tokensPerDay':
      return usage.tokensToday;
    case 'tokensPerMonth':
      return usage.tokensMonth;
    case 'messagesPerDay':
      return usage.messagesToday;
    case 'messagesPerMonth':
      return usage.messagesMonth;
  }
};

const resetFor = (metric: UsageLimitMetric, periods: UsagePeriods): Date =>
  metric.endsWith('PerDay') ? periods.dayEnd : periods.monthEnd;

/** The first metric the user has reached, or `null` when the next request may proceed. */
export function findExceededLimit(
  limits: ResolvedLimits,
  usage: UserUsageSnapshot,
  periods: UsagePeriods,
): LimitExceeded | null {
  for (const metric of USAGE_LIMIT_METRICS) {
    const { limit } = limits[metric];
    if (limit === null) {
      continue;
    }
    const used = usedFor(metric, usage);
    if (used >= limit) {
      return { metric, limit, used, resetAt: resetFor(metric, periods) };
    }
  }
  return null;
}

/** Effective limits paired with consumption, as the admin panel presents them. */
export function describeLimits(
  limits: ResolvedLimits,
  usage: UserUsageSnapshot,
): TEffectiveLimit[] {
  return USAGE_LIMIT_METRICS.map((metric) => ({
    metric,
    limit: limits[metric].limit,
    used: usedFor(metric, usage),
    source: limits[metric].source,
  }));
}
