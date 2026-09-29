import { getTenantId } from '@librechat/data-schemas';
import { isAgentsEndpoint, resolveGovernanceConfig } from 'librechat-data-provider';
import type {
  AppConfig,
  UsageLimitRecord,
  ModelPolicyRecord,
  UserUsageSnapshot,
  UsagePrincipalRef,
} from '@librechat/data-schemas';
import type {
  TModelSpec,
  TModelsConfig,
  TEffectiveModel,
  TEffectiveLimit,
  TGovernanceConfig,
} from 'librechat-data-provider';
import type { ModelPolicyIndex, ModelDecision } from './models';
import type { LimitExceeded, ResolvedLimits } from './limits';
import type { ResolvedPrincipal } from '~/types/principal';
import type { PrincipalSet } from './principals';
import { hasAnyLimit, describeLimits, findExceededLimit, resolveEffectiveLimits } from './limits';
import { decideModelAccess, filterModelsConfig, indexModelPolicies } from './models';
import { toPrincipalRefs, toPrincipalSet } from './principals';
import { getUsagePeriods } from './periods';
import { TtlCache } from './cache';

/** The identity fields governance reads from `req.user`. */
export type GovernanceUser = {
  id?: string;
  _id?: { toString(): string };
  role?: string;
  idOnTheSource?: string | null;
  tenantId?: string;
};

export interface GovernanceServiceDeps {
  listModelPolicies: () => Promise<ModelPolicyRecord[]>;
  findUsageLimitsForPrincipals: (principals: UsagePrincipalRef[]) => Promise<UsageLimitRecord[]>;
  getUserUsageSnapshot: (
    userId: string,
    bounds: { dayStart: Date; monthStart: Date },
  ) => Promise<UserUsageSnapshot>;
  getUserPrincipals: (params: {
    userId: string;
    role?: string | null;
    idOnTheSource?: string | null;
  }) => Promise<ResolvedPrincipal[]>;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export type UsageCheck = {
  limits: ResolvedLimits;
  usage: UserUsageSnapshot | null;
  exceeded: LimitExceeded | null;
};

const EMPTY_USAGE: UserUsageSnapshot = {
  tokensToday: 0,
  tokensMonth: 0,
  messagesToday: 0,
  messagesMonth: 0,
};

const userIdOf = (user: GovernanceUser): string => user.id ?? user._id?.toString() ?? '';
const tenantKey = (user?: GovernanceUser) => user?.tenantId ?? getTenantId() ?? '__default__';

type ModelAccessParams = {
  user: GovernanceUser;
  appConfig?: AppConfig | null;
  modelsConfig: TModelsConfig;
};

export interface GovernanceService {
  getSettings: (appConfig?: AppConfig | null) => TGovernanceConfig;
  applyModelAccess: (params: ModelAccessParams) => Promise<TModelsConfig>;
  filterModelSpecs: <T extends { list?: TModelSpec[] }>(params: {
    user: GovernanceUser;
    appConfig?: AppConfig | null;
    modelSpecs?: T;
  }) => Promise<T | undefined>;
  describeModelAccess: (params: ModelAccessParams) => Promise<TEffectiveModel[]>;
  getMaxOutputTokens: (params: {
    user?: GovernanceUser;
    appConfig?: AppConfig | null;
    endpoint: string;
    model: string;
  }) => Promise<number | undefined>;
  checkUsage: (params: {
    user: GovernanceUser;
    appConfig?: AppConfig | null;
    fresh?: boolean;
  }) => Promise<UsageCheck | null>;
  describeUsageLimits: (params: {
    user: GovernanceUser;
    appConfig?: AppConfig | null;
  }) => Promise<TEffectiveLimit[]>;
  invalidate: () => void;
}

/**
 * Evaluates administrator policies at request time: which models a user may pick
 * and whether the user may send another message under their usage limits.
 */
export function createGovernanceService(deps: GovernanceServiceDeps): GovernanceService {
  const now = deps.now ?? (() => new Date());
  const policyCache = new TtlCache<ModelPolicyIndex>(256);
  const limitCache = new TtlCache<UsageLimitRecord[]>();
  const usageCache = new TtlCache<UserUsageSnapshot>();

  function getSettings(appConfig?: AppConfig | null): TGovernanceConfig {
    return resolveGovernanceConfig(appConfig?.governance);
  }

  async function getPolicyIndex(
    settings: TGovernanceConfig,
    user?: GovernanceUser,
  ): Promise<ModelPolicyIndex> {
    return policyCache.wrap(tenantKey(user), settings.policyCacheSeconds * 1000, async () =>
      indexModelPolicies(await deps.listModelPolicies()),
    );
  }

  async function resolvePrincipals(user: GovernanceUser): Promise<PrincipalSet> {
    const userId = userIdOf(user);
    const principals = await deps.getUserPrincipals({
      userId,
      role: user.role ?? null,
      ...(user.idOnTheSource !== undefined ? { idOnTheSource: user.idOnTheSource } : {}),
    });
    return toPrincipalSet(userId, principals);
  }

  /** Whether any policy can change what this user sees, so the common case skips principal resolution. */
  const isUnrestricted = (index: ModelPolicyIndex, settings: TGovernanceConfig) =>
    index.size === 0 && settings.models.defaultPolicy === 'allow';

  /** Filters a provider catalog down to the models the user may use. */
  async function applyModelAccess(params: {
    user: GovernanceUser;
    appConfig?: AppConfig | null;
    modelsConfig: TModelsConfig;
  }): Promise<TModelsConfig> {
    const settings = getSettings(params.appConfig);
    const index = await getPolicyIndex(settings, params.user);
    if (isUnrestricted(index, settings)) {
      return params.modelsConfig;
    }
    const principals = await resolvePrincipals(params.user);
    return filterModelsConfig(
      params.modelsConfig,
      index,
      (endpoint, model) =>
        decideModelAccess(index, principals, endpoint, model, settings.models.defaultPolicy)
          .allowed,
    );
  }

  /**
   * Drops model specs whose preset model the user may not use, so the model picker
   * never offers a spec that would be refused. Agent specs are left to agent access.
   */
  async function filterModelSpecs<T extends { list?: TModelSpec[] }>(params: {
    user: GovernanceUser;
    appConfig?: AppConfig | null;
    modelSpecs?: T;
  }): Promise<T | undefined> {
    const { modelSpecs } = params;
    if (!modelSpecs?.list?.length) {
      return modelSpecs;
    }
    const settings = getSettings(params.appConfig);
    const index = await getPolicyIndex(settings, params.user);
    if (isUnrestricted(index, settings)) {
      return modelSpecs;
    }
    const principals = await resolvePrincipals(params.user);
    const list = modelSpecs.list.filter((spec) => {
      const { endpoint, model } = spec.preset ?? {};
      if (!endpoint || !model || isAgentsEndpoint(endpoint)) {
        return true;
      }
      return decideModelAccess(index, principals, endpoint, model, settings.models.defaultPolicy)
        .allowed;
    });
    return { ...modelSpecs, list };
  }

  /** Every catalog model with the decision and the level that made it, for the admin panel. */
  async function describeModelAccess(params: {
    user: GovernanceUser;
    appConfig?: AppConfig | null;
    modelsConfig: TModelsConfig;
  }): Promise<TEffectiveModel[]> {
    const settings = getSettings(params.appConfig);
    const [index, principals] = await Promise.all([
      getPolicyIndex(settings, params.user),
      resolvePrincipals(params.user),
    ]);
    const models: TEffectiveModel[] = [];
    for (const [endpoint, list] of Object.entries(params.modelsConfig)) {
      if (!Array.isArray(list)) {
        continue;
      }
      for (const model of list) {
        const decision: ModelDecision = decideModelAccess(
          index,
          principals,
          endpoint,
          model,
          settings.models.defaultPolicy,
        );
        models.push({ endpoint, model, ...decision });
      }
    }
    return models;
  }

  /** The output-token cap an administrator set on this model, if any. */
  async function getMaxOutputTokens(params: {
    user?: GovernanceUser;
    appConfig?: AppConfig | null;
    endpoint: string;
    model: string;
  }): Promise<number | undefined> {
    const settings = getSettings(params.appConfig);
    const index = await getPolicyIndex(settings, params.user);
    return (
      index.byModel.get(`${params.endpoint}|${params.model}`)?.maxOutputTokens ??
      index.byEndpoint.get(params.endpoint)?.maxOutputTokens
    );
  }

  async function loadLimitRecords(
    user: GovernanceUser,
    principals: PrincipalSet,
    ttlMs: number,
  ): Promise<UsageLimitRecord[]> {
    const key = `${tenantKey(user)}:${principals.userId}:${principals.role ?? ''}:${principals.groupIds.join(',')}`;
    return limitCache.wrap(key, ttlMs, () =>
      deps.findUsageLimitsForPrincipals(toPrincipalRefs(principals)),
    );
  }

  /**
   * Checks the user's usage against their effective limits. Consumption is read only
   * when at least one limit applies, so unlimited users cost one cached lookup.
   */
  async function checkUsage(params: {
    user: GovernanceUser;
    appConfig?: AppConfig | null;
    fresh?: boolean;
  }): Promise<UsageCheck | null> {
    const settings = getSettings(params.appConfig);
    if (!settings.limits.enabled) {
      return null;
    }
    const principals = await resolvePrincipals(params.user);
    const records = await loadLimitRecords(
      params.user,
      principals,
      params.fresh ? 0 : settings.policyCacheSeconds * 1000,
    );
    const limits = resolveEffectiveLimits(principals, records, settings.limits.defaults);
    if (!hasAnyLimit(limits)) {
      return { limits, usage: null, exceeded: null };
    }

    const periods = getUsagePeriods(now(), settings.limits.timeZone);
    const usageKey = `${tenantKey(params.user)}:${principals.userId}:${periods.dayStart.getTime()}`;
    const load = () =>
      deps.getUserUsageSnapshot(principals.userId, {
        dayStart: periods.dayStart,
        monthStart: periods.monthStart,
      });
    const usage = params.fresh
      ? await load()
      : await usageCache.wrap(usageKey, settings.usageCacheSeconds * 1000, load);
    return { limits, usage, exceeded: findExceededLimit(limits, usage, periods) };
  }

  /** Effective limits and current consumption for the admin panel (never cached). */
  async function describeUsageLimits(params: {
    user: GovernanceUser;
    appConfig?: AppConfig | null;
  }): Promise<TEffectiveLimit[]> {
    const settings = getSettings(params.appConfig);
    const principals = await resolvePrincipals(params.user);
    const records = await deps.findUsageLimitsForPrincipals(toPrincipalRefs(principals));
    const limits = resolveEffectiveLimits(principals, records, settings.limits.defaults);
    const periods = getUsagePeriods(now(), settings.limits.timeZone);
    const usage = await deps
      .getUserUsageSnapshot(principals.userId, {
        dayStart: periods.dayStart,
        monthStart: periods.monthStart,
      })
      .catch(() => EMPTY_USAGE);
    return describeLimits(limits, usage);
  }

  /** Drops cached policies and limits after an administrator changes them. */
  function invalidate(): void {
    policyCache.clear();
    limitCache.clear();
  }

  return {
    getSettings,
    applyModelAccess,
    filterModelSpecs,
    describeModelAccess,
    getMaxOutputTokens,
    checkUsage,
    describeUsageLimits,
    invalidate,
  };
}
