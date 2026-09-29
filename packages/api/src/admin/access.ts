import { z } from 'zod';
import { logger, SystemCapabilities, isValidObjectIdString } from '@librechat/data-schemas';
import {
  modelKey,
  parseModelKey,
  PermissionBits,
  usageLimitsSchema,
  ACCESS_PRINCIPAL_TYPES,
} from 'librechat-data-provider';
import type {
  TModelsConfig,
  TEffectiveAccess,
  TPrincipalAccess,
  TUsageLimitEntry,
  AccessPrincipalType,
} from 'librechat-data-provider';
import type {
  AppConfig,
  SystemCapability,
  DirectoryMethods,
  GovernanceMethods,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminAuditRecorder, AdminHandler, AdminActor } from './trail';
import type { AdminScopeResolver, CapabilityUser } from './scope';
import type { GovernanceService } from '~/governance/service';
import type { ServerRequest } from '~/types/http';
import { scopeIncludes, toCapabilityUser } from './scope';
import { resolveAdminActor } from './trail';

const MAX_KEYS = 2000;
const AGENT_ID = /^agent_[\w-]{1,200}$/;

const updateSchema = z.object({
  allowedModels: z.array(z.string().min(3).max(520)).max(MAX_KEYS).optional(),
  deniedModels: z.array(z.string().min(3).max(520)).max(MAX_KEYS).optional(),
  agentIds: z.array(z.string().regex(AGENT_ID)).max(MAX_KEYS).optional(),
  limits: usageLimitsSchema.optional(),
});

/** Resolved at call time so partial module mocks of data-schemas stay loadable. */
function readCapability(type: AccessPrincipalType): SystemCapability {
  if (type === 'user') {
    return SystemCapabilities.READ_USERS;
  }
  return type === 'group' ? SystemCapabilities.READ_GROUPS : SystemCapabilities.READ_ROLES;
}

/** The identity fields governance needs to evaluate a user other than the caller. */
export type GovernanceSubject = {
  id: string;
  role?: string;
  idOnTheSource?: string | null;
  tenantId?: string;
};

export interface AdminAccessDeps {
  governance: GovernanceService;
  resolveScope: AdminScopeResolver;
  hasCapability: (user: CapabilityUser, capability: SystemCapability) => Promise<boolean>;
  principalExists: (type: AccessPrincipalType, id: string) => Promise<boolean>;
  findGovernanceSubject: (userId: string) => Promise<GovernanceSubject | null>;
  getTenantConfig: (tenantId?: string) => Promise<AppConfig>;
  loadAvailableModels: (req: ServerRequest) => Promise<TModelsConfig>;
  listModelPolicies: GovernanceMethods['listModelPolicies'];
  setPrincipalModelGrants: GovernanceMethods['setPrincipalModelGrants'];
  findUsageLimitsForPrincipals: GovernanceMethods['findUsageLimitsForPrincipals'];
  setUsageLimits: GovernanceMethods['setUsageLimits'];
  listUsageLimits: GovernanceMethods['listUsageLimits'];
  /** Display names for principals, keyed by id; missing ids are shown by id. */
  resolvePrincipalNames: (type: AccessPrincipalType, ids: string[]) => Promise<Map<string, string>>;
  listPrincipalAgentAccess: DirectoryMethods['listPrincipalAgentAccess'];
  findAgentRefs: DirectoryMethods['findAgentRefs'];
  grantAgentViewer: (params: {
    principalType: AccessPrincipalType;
    principalId: string;
    resourceId: string;
    grantedBy: string;
  }) => Promise<unknown>;
  revokeAgentAccess: (params: {
    principalType: AccessPrincipalType;
    principalId: string;
    resourceId: string;
  }) => Promise<unknown>;
  recordAdminAction: AdminAuditRecorder;
}

function isAccessPrincipalType(value: string): value is AccessPrincipalType {
  return (ACCESS_PRINCIPAL_TYPES as readonly string[]).includes(value);
}

function validPrincipalId(type: AccessPrincipalType, id: string): boolean {
  if (type === 'role') {
    return id.length > 0 && id.length <= 256;
  }
  return isValidObjectIdString(id);
}

const validModelKeys = (keys: string[]) => keys.every((key) => parseModelKey(key) != null);

/**
 * Explicit access of one user, group or role — the model grants, agent shares and
 * usage limits set at that level — and a user's resulting effective access.
 */
export function createAdminAccessHandlers(
  deps: AdminAccessDeps,
): Record<'getAccess' | 'updateAccess' | 'effective' | 'listLimits', AdminHandler> {
  async function canRead(
    actor: AdminActor,
    type: AccessPrincipalType,
    id: string,
  ): Promise<boolean> {
    if (type === 'user') {
      const scope = await deps.resolveScope(actor, readCapability('user'));
      return scopeIncludes(scope, id);
    }
    return deps.hasCapability(toCapabilityUser(actor), readCapability(type));
  }

  async function loadAccess(type: AccessPrincipalType, id: string): Promise<TPrincipalAccess> {
    const [policies, agents, limits] = await Promise.all([
      deps.listModelPolicies(),
      deps.listPrincipalAgentAccess(type, id),
      deps.findUsageLimitsForPrincipals([{ principalType: type, principalId: id }]),
    ]);
    const allowedModels: string[] = [];
    const deniedModels: string[] = [];
    for (const policy of policies) {
      for (const grant of policy.grants) {
        if (grant.principalType !== type || grant.principalId !== id) {
          continue;
        }
        const key = modelKey(policy.endpoint, policy.model);
        (grant.effect === 'deny' ? deniedModels : allowedModels).push(key);
      }
    }
    return {
      principalType: type,
      principalId: id,
      allowedModels,
      deniedModels,
      agentIds: agents
        .filter((agent) => (agent.permBits & PermissionBits.VIEW) === PermissionBits.VIEW)
        .map((agent) => agent.id),
      limits: limits[0]?.limits ?? {},
    };
  }

  async function getAccess(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { principalType, principalId } = req.params as {
        principalType: string;
        principalId: string;
      };
      if (!isAccessPrincipalType(principalType) || !validPrincipalId(principalType, principalId)) {
        return res.status(400).json({ error: 'Invalid principal' });
      }
      if (!(await canRead(actor, principalType, principalId))) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      return res.status(200).json(await loadAccess(principalType, principalId));
    } catch (error) {
      logger.error('[adminAccess] getAccess error:', error);
      return res.status(500).json({ error: 'Failed to load access' });
    }
  }

  /** Whether the actor may change the limits of this principal (globally, or as its manager). */
  async function canManageLimits(actor: AdminActor, type: AccessPrincipalType, id: string) {
    if (await deps.hasCapability(toCapabilityUser(actor), SystemCapabilities.MANAGE_LIMITS)) {
      return true;
    }
    if (type !== 'user') {
      return false;
    }
    const scope = await deps.resolveScope(actor, SystemCapabilities.MANAGE_LIMITS);
    return scope.kind === 'team' && scope.canManage && scope.userIds.includes(id);
  }

  async function syncAgents(
    actor: AdminActor,
    type: AccessPrincipalType,
    id: string,
    agentIds: string[],
  ): Promise<{ granted: number; revoked: number; kept: number }> {
    const current = await deps.listPrincipalAgentAccess(type, id);
    const wanted = new Set(agentIds);
    const currentIds = new Set(current.map((agent) => agent.id));
    const toGrant = agentIds.filter((agentId) => !currentIds.has(agentId));
    /** Only view-only shares are revoked here: an editor or owner share is not the panel's to remove. */
    const toRevoke = current.filter(
      (agent) => !wanted.has(agent.id) && agent.permBits === PermissionBits.VIEW,
    );
    const kept = current.filter(
      (agent) => !wanted.has(agent.id) && agent.permBits !== PermissionBits.VIEW,
    ).length;
    const refs = await deps.findAgentRefs(toGrant);
    await Promise.all([
      ...refs.map((agent) =>
        deps.grantAgentViewer({
          principalType: type,
          principalId: id,
          resourceId: agent._id,
          grantedBy: actor.userId,
        }),
      ),
      ...toRevoke.map((agent) =>
        deps.revokeAgentAccess({ principalType: type, principalId: id, resourceId: agent._id }),
      ),
    ]);
    return { granted: refs.length, revoked: toRevoke.length, kept };
  }

  async function updateAccess(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { principalType, principalId } = req.params as {
        principalType: string;
        principalId: string;
      };
      if (!isAccessPrincipalType(principalType) || !validPrincipalId(principalType, principalId)) {
        return res.status(400).json({ error: 'Invalid principal' });
      }
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid access' });
      }
      const update = parsed.data;
      const changesModels = update.allowedModels !== undefined || update.deniedModels !== undefined;
      if (
        changesModels &&
        !validModelKeys([...(update.allowedModels ?? []), ...(update.deniedModels ?? [])])
      ) {
        return res.status(400).json({ error: 'Invalid model key' });
      }

      const capabilityUser = toCapabilityUser(actor);
      const [canModels, canAgents, canLimits] = await Promise.all([
        changesModels
          ? deps.hasCapability(capabilityUser, SystemCapabilities.MANAGE_MODELS)
          : Promise.resolve(true),
        update.agentIds !== undefined
          ? deps.hasCapability(capabilityUser, SystemCapabilities.MANAGE_AGENTS)
          : Promise.resolve(true),
        update.limits !== undefined
          ? canManageLimits(actor, principalType, principalId)
          : Promise.resolve(true),
      ]);
      if (!canModels || !canAgents || !canLimits) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      if (!(await deps.principalExists(principalType, principalId))) {
        return res.status(404).json({ error: 'Principal not found' });
      }

      const principal = { principalType, principalId };
      const target = { type: principalType, id: principalId };
      if (changesModels) {
        const current = await loadAccess(principalType, principalId);
        const allowedModels = update.allowedModels ?? current.allowedModels;
        const deniedModels = (update.deniedModels ?? current.deniedModels).filter(
          (key) => !allowedModels.includes(key),
        );
        await deps.setPrincipalModelGrants({
          principal,
          allowedModels,
          deniedModels,
          updatedBy: actor.userId,
        });
        await deps.recordAdminAction(req, {
          action: 'permission.access_updated',
          severity: 'warning',
          target,
          metadata: {
            kind: 'models',
            allowed: allowedModels.length,
            denied: deniedModels.length,
          },
        });
      }
      if (update.agentIds !== undefined) {
        const result = await syncAgents(actor, principalType, principalId, update.agentIds);
        await deps.recordAdminAction(req, {
          action: 'agent.access_updated',
          target,
          metadata: { kind: 'agents', ...result },
        });
      }
      if (update.limits !== undefined) {
        await deps.setUsageLimits({ principal, limits: update.limits, updatedBy: actor.userId });
        await deps.recordAdminAction(req, {
          action: 'usage.limits_updated',
          severity: 'warning',
          target,
          metadata: {
            tokensPerDay: update.limits.tokensPerDay ?? null,
            tokensPerMonth: update.limits.tokensPerMonth ?? null,
            messagesPerDay: update.limits.messagesPerDay ?? null,
            messagesPerMonth: update.limits.messagesPerMonth ?? null,
          },
        });
      }
      deps.governance.invalidate();
      return res.status(200).json(await loadAccess(principalType, principalId));
    } catch (error) {
      logger.error('[adminAccess] updateAccess error:', error);
      return res.status(500).json({ error: 'Failed to update access' });
    }
  }

  /** What a user can actually use once user, group, role and default settings combine. */
  async function effective(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user id' });
      }
      if (!(await canRead(actor, 'user', id))) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const subject = await deps.findGovernanceSubject(id);
      if (!subject) {
        return res.status(404).json({ error: 'User not found' });
      }
      const [appConfig, catalog] = await Promise.all([
        deps.getTenantConfig(subject.tenantId),
        deps.loadAvailableModels(req),
      ]);
      const [models, limits] = await Promise.all([
        deps.governance.describeModelAccess({ user: subject, appConfig, modelsConfig: catalog }),
        deps.governance.describeUsageLimits({ user: subject, appConfig }),
      ]);
      const body: TEffectiveAccess = { models, limits };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminAccess] effective error:', error);
      return res.status(500).json({ error: 'Failed to resolve effective access' });
    }
  }

  /**
   * Every explicit usage limit with its principal's display name. Managers see only
   * the user-level limits of their team.
   */
  async function listLimits(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const scope = await deps.resolveScope(actor, SystemCapabilities.READ_USAGE);
      if (scope.kind === 'none') {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const records = await deps.listUsageLimits();
      const visible = records.filter(
        (record) =>
          scope.kind === 'global' ||
          (record.principalType === 'user' && scope.userIds.includes(record.principalId)),
      );
      const idsByType = new Map<AccessPrincipalType, string[]>();
      for (const record of visible) {
        const ids = idsByType.get(record.principalType) ?? [];
        ids.push(record.principalId);
        idsByType.set(record.principalType, ids);
      }
      const names = new Map<string, string>();
      await Promise.all(
        [...idsByType].map(async ([type, ids]) => {
          const resolved = await deps.resolvePrincipalNames(type, ids);
          for (const [id, name] of resolved) {
            names.set(`${type}:${id}`, name);
          }
        }),
      );
      const limits: TUsageLimitEntry[] = visible.map((record) => ({
        principalType: record.principalType,
        principalId: record.principalId,
        principalName: names.get(`${record.principalType}:${record.principalId}`),
        limits: record.limits,
        updatedAt: record.updatedAt?.toISOString(),
      }));
      return res.status(200).json({ limits });
    } catch (error) {
      logger.error('[adminAccess] listLimits error:', error);
      return res.status(500).json({ error: 'Failed to list usage limits' });
    }
  }

  return { getAccess, updateAccess, effective, listLimits };
}
