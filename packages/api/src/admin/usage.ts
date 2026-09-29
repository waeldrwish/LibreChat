import { logger, SystemCapabilities, isValidObjectIdString } from '@librechat/data-schemas';
import type { TUsageReport, TUsageGranularity } from 'librechat-data-provider';
import type { UsageWindow, UsageMethods } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminScopeResolver } from './scope';
import type { AdminHandler } from './trail';
import { isValidTimeZone } from '~/governance/periods';
import { resolveAdminActor } from './trail';
import { scopeUserIds } from './scope';

const MAX_RANGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ID_LENGTH = 256;

export interface AdminUsageDeps {
  resolveScope: AdminScopeResolver;
  getGroupMemberUserIds: (groupIds: string[]) => Promise<string[]>;
  getUsageTotals: UsageMethods['getUsageTotals'];
  getUsageSeries: UsageMethods['getUsageSeries'];
  getUsageByModel: UsageMethods['getUsageByModel'];
  getUsageByUser: UsageMethods['getUsageByUser'];
  getUsageByAgent: UsageMethods['getUsageByAgent'];
  findAgentConversationIds: UsageMethods['findAgentConversationIds'];
}

type UsageQuery = {
  from?: string;
  to?: string;
  userId?: string;
  groupId?: string;
  model?: string;
  agentId?: string;
  unit?: string;
  timeZone?: string;
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    ? value
    : undefined;

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const intersect = (a: string[] | undefined, b: string[]): string[] =>
  a === undefined ? b : b.filter((id) => a.includes(id));

/** Usage reports built from transactions, messages and conversations. */
export function createAdminUsageHandlers(deps: AdminUsageDeps): Record<'report', AdminHandler> {
  async function report(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const scope = await deps.resolveScope(actor, SystemCapabilities.READ_USAGE);
      if (scope.kind === 'none') {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = req.query as UsageQuery;
      const from = parseDate(query.from);
      const to = parseDate(query.to);
      if (!from || !to || from >= to) {
        return res.status(400).json({ error: 'A valid from/to range is required' });
      }
      if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
        return res.status(400).json({ error: `Range must not exceed ${MAX_RANGE_DAYS} days` });
      }
      const unit: TUsageGranularity = query.unit === 'month' ? 'month' : 'day';
      const timeZone = query.timeZone && isValidTimeZone(query.timeZone) ? query.timeZone : 'UTC';

      let userIds = scopeUserIds(scope);
      const groupId = asString(query.groupId);
      if (groupId) {
        if (!isValidObjectIdString(groupId)) {
          return res.status(400).json({ error: 'Invalid group id' });
        }
        userIds = intersect(userIds, await deps.getGroupMemberUserIds([groupId]));
      }
      const userId = asString(query.userId);
      if (userId) {
        if (!isValidObjectIdString(userId)) {
          return res.status(400).json({ error: 'Invalid user id' });
        }
        userIds = intersect(userIds, [userId]);
      }

      const window: UsageWindow = { from, to, userIds, model: asString(query.model) };
      const agentId = asString(query.agentId);
      if (agentId) {
        window.conversationIds = await deps.findAgentConversationIds(agentId, window);
      }

      const [totals, series, byModel, byUser, byAgent] = await Promise.all([
        deps.getUsageTotals(window),
        deps.getUsageSeries(window, unit, timeZone),
        deps.getUsageByModel(window, 20),
        deps.getUsageByUser(window, 20),
        deps.getUsageByAgent(window, 20),
      ]);
      const body: TUsageReport = { totals, series, byModel, byUser, byAgent };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminUsage] report error:', error);
      return res.status(500).json({ error: 'Failed to build usage report' });
    }
  }

  return { report };
}
