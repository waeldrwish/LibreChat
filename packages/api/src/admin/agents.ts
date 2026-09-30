import { logger, SystemCapabilities } from '@librechat/data-schemas';
import { SystemRoles, Permissions, PermissionTypes } from 'librechat-data-provider';
import type {
  TAdminAgent,
  TAdminAgentPolicy,
  TAdminAgentsPage,
  TAdminAgentPolicyRole,
} from 'librechat-data-provider';
import type {
  IRole,
  SystemCapability,
  DirectoryMethods,
  AdminAgentRecord,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminAuditRecorder, AdminHandler } from './trail';
import type { ServerRequest } from '~/types/http';
import type { CapabilityUser } from './scope';
import { parsePagination } from './pagination';
import { resolveAdminActor } from './trail';
import { toCapabilityUser } from './scope';

export interface AdminAgentsDeps {
  listAdminAgents: DirectoryMethods['listAdminAgents'];
  setAgentDisabled: DirectoryMethods['setAgentDisabled'];
  summarizeAgentSharing: DirectoryMethods['summarizeAgentSharing'];
  recordAdminAction: AdminAuditRecorder;
}

export interface AdminAgentPolicyDeps {
  listRoles: (params: { limit: number; offset: number }) => Promise<Pick<IRole, 'name'>[]>;
  getRoleByName: (name: string) => Promise<IRole | null>;
  updateAccessPermissions: (
    name: string,
    perms: Record<string, Record<string, boolean>>,
    roleData?: IRole,
  ) => Promise<unknown>;
  hasCapability: (user: CapabilityUser, capability: SystemCapability) => Promise<boolean>;
  recordAdminAction: AdminAuditRecorder;
}

const MAX_ROLES = 200;

/** The role permissions that let a role build agents (create/edit/delete) and hand them out. */
const BUILDER_PERMISSIONS = [Permissions.CREATE, Permissions.SHARE, Permissions.SHARE_PUBLIC];

function policyRole(role: IRole): TAdminAgentPolicyRole {
  const agents = (role.permissions?.[PermissionTypes.AGENTS] ?? {}) as Record<string, boolean>;
  return {
    name: role.name,
    create: agents[Permissions.CREATE] === true,
    share: agents[Permissions.SHARE] === true || agents[Permissions.SHARE_PUBLIC] === true,
  };
}

/**
 * Who may build agents outside the admin panel. "Admin only" withdraws the create and share
 * permissions from every role but ADMIN, which the agents and sharing routes enforce; the
 * admin panel keeps working through the ADMIN role and the agent-management capability.
 */
export function createAdminAgentPolicyHandlers(
  deps: AdminAgentPolicyDeps,
): Record<'get' | 'update', AdminHandler> {
  async function loadRoles(): Promise<IRole[]> {
    const names = await deps.listRoles({ limit: MAX_ROLES, offset: 0 });
    const roleNames = [
      ...new Set([SystemRoles.ADMIN, SystemRoles.USER, ...names.map(({ name }) => name)]),
    ];
    const roles = await Promise.all(roleNames.map((name) => deps.getRoleByName(name)));
    return roles.filter((role): role is IRole => role != null);
  }

  async function describe(req: ServerRequest, roles: IRole[]): Promise<TAdminAgentPolicy> {
    const actor = resolveAdminActor(req);
    const canManage = actor
      ? await deps.hasCapability(toCapabilityUser(actor), SystemCapabilities.MANAGE_ROLES)
      : false;
    const described = roles.map(policyRole);
    return {
      adminOnly: described
        .filter((role) => role.name !== SystemRoles.ADMIN)
        .every((role) => !role.create && !role.share),
      roles: described,
      canManage,
    };
  }

  async function get(req: ServerRequest, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await describe(req, await loadRoles()));
    } catch (error) {
      logger.error('[adminAgents] policy error:', error);
      return res.status(500).json({ error: 'Failed to load the agent policy' });
    }
  }

  async function update(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const adminOnly = (req.body as { adminOnly?: unknown })?.adminOnly;
      if (typeof adminOnly !== 'boolean') {
        return res.status(400).json({ error: 'adminOnly must be a boolean' });
      }
      const allowed = !adminOnly;
      const roles = (await loadRoles()).filter((role) => role.name !== SystemRoles.ADMIN);
      const changed = roles.filter((role) => {
        const current = policyRole(role);
        return current.create !== allowed || current.share !== allowed;
      });
      await Promise.all(
        changed.map((role) =>
          deps.updateAccessPermissions(
            role.name,
            {
              [PermissionTypes.AGENTS]: Object.fromEntries(
                BUILDER_PERMISSIONS.map((permission) => [permission, allowed]),
              ),
            },
            role,
          ),
        ),
      );
      await Promise.all(
        changed.map((role) =>
          deps.recordAdminAction(req, {
            action: 'role.permissions_updated',
            severity: adminOnly ? 'warning' : 'info',
            target: { type: 'role', id: role.name, name: role.name },
            metadata: { agentCreate: allowed, agentShare: allowed, adminOnly },
          }),
        ),
      );
      return res.status(200).json(await describe(req, await loadRoles()));
    } catch (error) {
      logger.error('[adminAgents] policy update error:', error);
      return res.status(500).json({ error: 'Failed to update the agent policy' });
    }
  }

  return { get, update };
}

const AGENT_ID = /^agent_[\w-]{1,200}$/;

function toAdminAgent(
  record: AdminAgentRecord,
  sharing?: { sharedWith: number; isPublic: boolean },
): TAdminAgent {
  return {
    _id: record._id,
    id: record.id,
    name: record.name ?? record.id,
    description: record.description,
    provider: record.provider,
    model: record.model,
    author: record.author?.toString(),
    authorName: record.authorName,
    category: record.category,
    disabled: record.disabled === true,
    avatar: record.avatar ?? null,
    toolCount: record.toolCount,
    sharedWith: sharing?.sharedWith ?? 0,
    isPublic: sharing?.isPublic ?? false,
    updatedAt: record.updatedAt?.toISOString(),
  };
}

/** Agent inventory and the administrative enable/disable switch. */
export function createAdminAgentsHandlers(
  deps: AdminAgentsDeps,
): Record<'list' | 'setStatus', AdminHandler> {
  async function list(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { limit, offset } = parsePagination(req.query as { limit?: string; offset?: string });
      const query = req.query as { search?: string; status?: string };
      const status =
        query.status === 'enabled' || query.status === 'disabled' ? query.status : undefined;
      const { agents, total } = await deps.listAdminAgents({
        search: typeof query.search === 'string' ? query.search : undefined,
        status,
        limit,
        offset,
      });
      const sharing = await deps.summarizeAgentSharing(agents.map((agent) => agent._id));
      const body: TAdminAgentsPage = {
        agents: agents.map((agent) => toAdminAgent(agent, sharing.get(agent._id))),
        total,
        limit,
        offset,
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminAgents] list error:', error);
      return res.status(500).json({ error: 'Failed to list agents' });
    }
  }

  async function setStatus(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params as { id: string };
      if (!AGENT_ID.test(id)) {
        return res.status(400).json({ error: 'Invalid agent id' });
      }
      const disabled = (req.body as { disabled?: unknown })?.disabled;
      if (typeof disabled !== 'boolean') {
        return res.status(400).json({ error: 'disabled must be a boolean' });
      }
      const updated = await deps.setAgentDisabled(id, disabled);
      if (!updated) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      await deps.recordAdminAction(req, {
        action: disabled ? 'agent.disabled' : 'agent.enabled',
        severity: disabled ? 'warning' : 'info',
        target: { type: 'agent', id: updated.id, name: updated.name },
      });
      return res.status(200).json({ agent: toAdminAgent(updated) });
    } catch (error) {
      logger.error('[adminAgents] setStatus error:', error);
      return res.status(500).json({ error: 'Failed to update agent status' });
    }
  }

  return { list, setStatus };
}
