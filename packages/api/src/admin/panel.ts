import { logger, SystemCapabilities, BASE_CONFIG_PRINCIPAL_ID } from '@librechat/data-schemas';
import {
  PrincipalType,
  PrincipalModel,
  governanceSchema,
  resolveGovernanceConfig,
  ADMIN_PANEL_LANGUAGE_USER,
} from 'librechat-data-provider';
import type {
  TUsageTotals,
  TAdminScope,
  TAdminSettings,
  TAdminAuthSettings,
  TModelsConfig,
  TAdminSession,
  TAdminOverview,
  TGovernanceConfig,
} from 'librechat-data-provider';
import type {
  IConfig,
  AppConfig,
  UsageWindow,
  SystemCapability,
  ModelPolicyRecord,
} from '@librechat/data-schemas';
import type { UsageMethods } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminScopeResolver, CapabilityUser } from './scope';
import type { AdminAuditRecorder, AdminHandler } from './trail';
import type { ServerRequest } from '~/types/http';
import { getUsagePeriods, isValidTimeZone } from '~/governance/periods';
import { scopeUserIds, toCapabilityUser } from './scope';
import { resolveAdminActor } from './trail';

/**
 * Every base capability, read to decide which panel sections to show. Resolved at
 * call time (not import time) so partial module mocks of data-schemas stay loadable.
 */
const panelCapabilities = (): SystemCapability[] => Object.values(SystemCapabilities);

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERVIEW_SERIES_DAYS = 30;

export type AdminAuthSettings = TAdminAuthSettings;
export type AdminSettingsResponse = TAdminSettings;

export interface AdminPanelDeps {
  getHeldCapabilities: (
    user: CapabilityUser,
    capabilities: SystemCapability[],
  ) => Promise<Set<SystemCapability>>;
  resolveScope: AdminScopeResolver;
  /** The tenant-wide config (YAML merged with the base DB override), without principal overrides. */
  getTenantConfig: (tenantId?: string) => Promise<AppConfig>;
  /** The catalog of enabled providers, before any policy filter. */
  loadAvailableModels: (req: ServerRequest) => Promise<TModelsConfig>;
  listModelPolicies: () => Promise<ModelPolicyRecord[]>;
  countAdminUsers: () => Promise<{ total: number; disabled: number }>;
  countAdminAgents: () => Promise<{ total: number; disabled: number }>;
  getUsageTotals: UsageMethods['getUsageTotals'];
  getUsageSeries: UsageMethods['getUsageSeries'];
  getUsageByModel: UsageMethods['getUsageByModel'];
  getUsageByUser: UsageMethods['getUsageByUser'];
  findConfigByPrincipal: (
    principalType: PrincipalType,
    principalId: string,
    options?: { includeInactive?: boolean },
  ) => Promise<IConfig | null>;
  patchConfigFields: (
    principalType: PrincipalType,
    principalId: string,
    principalModel: PrincipalModel,
    fields: Record<string, unknown>,
    priority: number,
  ) => Promise<IConfig | null>;
  invalidateConfigCaches?: (tenantId?: string) => Promise<unknown>;
  /** Drops the governance service's cached policies after settings change. */
  invalidateGovernance: () => void;
  getAuthSettings: (appConfig: AppConfig) => AdminAuthSettings;
  recordAdminAction: AdminAuditRecorder;
}

const envEnabled = (value?: string) => value?.toLowerCase().trim() === 'true';

/** Derives the sign-in facts the settings page shows from the environment and config. */
export function readAuthSettings(env: NodeJS.ProcessEnv, appConfig?: AppConfig): AdminAuthSettings {
  const openidEnabled =
    !!env.OPENID_CLIENT_ID &&
    (envEnabled(env.OPENID_USE_PKCE) || !!env.OPENID_CLIENT_SECRET?.trim()) &&
    !!env.OPENID_ISSUER &&
    !!env.OPENID_SESSION_SECRET;
  const ldapEnabled = !!env.LDAP_URL && !!env.LDAP_USER_SEARCH_BASE;
  return {
    emailLoginEnabled: env.ALLOW_EMAIL_LOGIN === undefined || envEnabled(env.ALLOW_EMAIL_LOGIN),
    registrationEnabled: !ldapEnabled && envEnabled(env.ALLOW_REGISTRATION),
    passwordResetEnabled: envEnabled(env.ALLOW_PASSWORD_RESET),
    socialLogins: envEnabled(env.ALLOW_SOCIAL_LOGIN)
      ? (appConfig?.registration?.socialLogins ?? []).filter(
          (login): login is string => typeof login === 'string',
        )
      : [],
    openidEnabled,
    samlEnabled:
      !openidEnabled &&
      !!env.SAML_ENTRY_POINT &&
      !!env.SAML_ISSUER &&
      !!env.SAML_CERT &&
      !!env.SAML_SESSION_SECRET,
    ldapEnabled,
  };
}

function resolvePanelLanguage(settings: TGovernanceConfig): string {
  return settings.adminPanel.language === ADMIN_PANEL_LANGUAGE_USER
    ? ADMIN_PANEL_LANGUAGE_USER
    : settings.adminPanel.language;
}

/** A manager (team capabilities without global user or usage access) sees only their team. */
function resolveSessionScope(access: boolean, held: Set<SystemCapability>): TAdminScope {
  if (!access) {
    return 'none';
  }
  const hasGlobalView =
    held.has(SystemCapabilities.READ_USERS) || held.has(SystemCapabilities.READ_USAGE);
  const hasTeamView =
    held.has(SystemCapabilities.READ_TEAM) || held.has(SystemCapabilities.MANAGE_TEAM);
  return !hasGlobalView && hasTeamView ? 'team' : 'global';
}

export function createAdminPanelHandlers(
  deps: AdminPanelDeps,
): Record<'session' | 'overview' | 'getSettings' | 'updateSettings', AdminHandler> {
  async function session(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const [held, appConfig] = await Promise.all([
        deps.getHeldCapabilities(toCapabilityUser(actor), panelCapabilities()),
        deps.getTenantConfig(actor.tenantId),
      ]);
      const settings = resolveGovernanceConfig(appConfig?.governance);
      const access = settings.adminPanel.enabled && held.has(SystemCapabilities.ACCESS_ADMIN);
      const body: TAdminSession = {
        enabled: settings.adminPanel.enabled,
        access,
        scope: resolveSessionScope(access, held),
        capabilities: access ? [...held] : [],
        language: resolvePanelLanguage(settings),
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminPanel] session error:', error);
      return res.status(500).json({ error: 'Failed to resolve admin session' });
    }
  }

  async function overview(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const scope = await deps.resolveScope(actor, SystemCapabilities.READ_USAGE);
      if (scope.kind === 'none') {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const appConfig = await deps.getTenantConfig(actor.tenantId);
      const settings = resolveGovernanceConfig(appConfig?.governance);
      const rawZone = typeof req.query.timeZone === 'string' ? req.query.timeZone : undefined;
      const timeZone = rawZone && isValidTimeZone(rawZone) ? rawZone : settings.limits.timeZone;
      const now = new Date();
      const periods = getUsagePeriods(now, timeZone);
      const userIds = scopeUserIds(scope);
      const today: UsageWindow = { from: periods.dayStart, to: periods.dayEnd, userIds };
      const month: UsageWindow = { from: periods.monthStart, to: periods.monthEnd, userIds };
      const series: UsageWindow = {
        from: new Date(periods.dayStart.getTime() - (OVERVIEW_SERIES_DAYS - 1) * DAY_MS),
        to: periods.dayEnd,
        userIds,
      };
      const isGlobal = scope.kind === 'global';

      const [
        todayTotals,
        monthTotals,
        topModels,
        topUsers,
        points,
        users,
        agents,
        catalog,
        policies,
      ] = await Promise.all([
        deps.getUsageTotals(today),
        deps.getUsageTotals(month),
        deps.getUsageByModel(month, 5),
        deps.getUsageByUser(month, 5),
        deps.getUsageSeries(series, 'day', timeZone),
        isGlobal
          ? deps.countAdminUsers()
          : Promise.resolve({ total: userIds?.length ?? 0, disabled: 0 }),
        isGlobal ? deps.countAdminAgents() : Promise.resolve({ total: 0, disabled: 0 }),
        isGlobal ? deps.loadAvailableModels(req).catch(() => ({})) : Promise.resolve({}),
        isGlobal ? deps.listModelPolicies() : Promise.resolve([]),
      ]);

      const disabledModels = new Set(
        policies
          .filter((policy) => policy.enabled === false)
          .map((policy) => `${policy.endpoint}|${policy.model}`),
      );
      const disabledEndpoints = new Set(
        policies
          .filter((policy) => policy.enabled === false && policy.model === '*')
          .map((policy) => policy.endpoint),
      );
      let activeModels = 0;
      for (const [endpoint, models] of Object.entries(catalog as TModelsConfig)) {
        if (!Array.isArray(models) || disabledEndpoints.has(endpoint)) {
          continue;
        }
        activeModels += models.filter(
          (model) => !disabledModels.has(`${endpoint}|${model}`),
        ).length;
      }

      const monthActive: TUsageTotals = monthTotals;
      const body: TAdminOverview = {
        users: {
          total: users.total,
          active: monthActive.activeUsers,
          disabled: users.disabled,
        },
        models: { active: activeModels, policies: policies.length },
        agents,
        today: todayTotals,
        month: monthTotals,
        topModels,
        topUsers,
        series: points,
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminPanel] overview error:', error);
      return res.status(500).json({ error: 'Failed to load overview' });
    }
  }

  async function getSettings(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const appConfig = await deps.getTenantConfig(actor.tenantId);
      const body: AdminSettingsResponse = {
        governance: resolveGovernanceConfig(appConfig?.governance),
        auth: deps.getAuthSettings(appConfig),
        balance: {
          enabled: appConfig?.balance?.enabled === true,
          startBalance: appConfig?.balance?.startBalance,
        },
        transactions: { enabled: appConfig?.transactions?.enabled !== false },
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminPanel] getSettings error:', error);
      return res.status(500).json({ error: 'Failed to load settings' });
    }
  }

  /** Replaces the tenant-wide `governance` section stored in the base config override. */
  async function updateSettings(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const parsed = governanceSchema.safeParse((req.body as { governance?: unknown })?.governance);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid governance settings' });
      }
      if (!isValidTimeZone(parsed.data.limits.timeZone)) {
        return res.status(400).json({ error: 'Invalid time zone' });
      }
      const existing = await deps.findConfigByPrincipal(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        { includeInactive: true },
      );
      await deps.patchConfigFields(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        { governance: parsed.data },
        existing?.priority ?? 0,
      );
      deps.invalidateGovernance();
      await deps
        .invalidateConfigCaches?.(actor.tenantId)
        ?.catch((error: unknown) =>
          logger.error('[adminPanel] Config cache invalidation failed:', error),
        );
      await deps.recordAdminAction(req, {
        action: 'config.updated',
        severity: 'warning',
        target: { type: 'config', id: 'governance', name: 'governance' },
        metadata: {
          defaultModelPolicy: parsed.data.models.defaultPolicy,
          limitsEnabled: parsed.data.limits.enabled,
          panelEnabled: parsed.data.adminPanel.enabled,
          language: parsed.data.adminPanel.language,
        },
      });
      return res.status(200).json({ governance: parsed.data });
    } catch (error) {
      logger.error('[adminPanel] updateSettings error:', error);
      return res.status(500).json({ error: 'Failed to update settings' });
    }
  }

  return { session, overview, getSettings, updateSettings };
}
