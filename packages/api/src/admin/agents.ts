import { logger } from '@librechat/data-schemas';
import type { DirectoryMethods, AdminAgentRecord } from '@librechat/data-schemas';
import type { TAdminAgent, TAdminAgentsPage } from 'librechat-data-provider';
import type { Response } from 'express';
import type { AdminAuditRecorder, AdminHandler } from './trail';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';

export interface AdminAgentsDeps {
  listAdminAgents: DirectoryMethods['listAdminAgents'];
  setAgentDisabled: DirectoryMethods['setAgentDisabled'];
  summarizeAgentSharing: DirectoryMethods['summarizeAgentSharing'];
  recordAdminAction: AdminAuditRecorder;
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
