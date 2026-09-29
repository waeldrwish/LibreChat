import type {
  TUsagePoint,
  TUsageTotals,
  TUsageByUser,
  TUsageByAgent,
  TUsageByModel,
  TUsageGranularity,
} from 'librechat-data-provider';
import type { Model, PipelineStage } from 'mongoose';
import type { IConversation, IMessage, IUser, IAgent } from '~/types';
import type { ITransaction } from '~/schema/transaction';

/** Transaction credits per USD (`tokenCredits: 1_000_000` = $1). */
const CREDITS_PER_USD = 1_000_000;
const SPEND_TOKEN_TYPES = ['prompt', 'completion'];
const CONVERSATIONS_COLLECTION = 'conversations';
const MAX_BREAKDOWN_ROWS = 100;

/** Bounds of a usage query. All filters are optional and combine with AND. */
export type UsageWindow = {
  from: Date;
  to: Date;
  /** Restricts to these user ids (the scope of a manager, a group, or one user). */
  userIds?: string[];
  /** Exact LLM model id recorded on transactions. */
  model?: string;
  /** Restricts to these conversations (e.g. those of one agent). */
  conversationIds?: string[];
};

export type UserUsageSnapshot = {
  tokensToday: number;
  tokensMonth: number;
  messagesToday: number;
  messagesMonth: number;
};

type SpendSums = {
  promptTokens: number;
  completionTokens: number;
  credits: number;
  requests: number;
};

const EMPTY_SUMS: SpendSums = { promptTokens: 0, completionTokens: 0, credits: 0, requests: 0 };

function validTimeZone(timeZone?: string): string {
  if (!timeZone) {
    return 'UTC';
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
    return timeZone;
  } catch {
    return 'UTC';
  }
}

const absAmount = (field: string) => ({ $abs: { $ifNull: [field, 0] } });

/** `$group` accumulators shared by every transaction breakdown. */
const spendAccumulators = {
  promptTokens: {
    $sum: { $cond: [{ $eq: ['$tokenType', 'prompt'] }, absAmount('$rawAmount'), 0] },
  },
  completionTokens: {
    $sum: { $cond: [{ $eq: ['$tokenType', 'completion'] }, absAmount('$rawAmount'), 0] },
  },
  credits: { $sum: absAmount('$tokenValue') },
  requests: { $sum: { $cond: [{ $eq: ['$tokenType', 'prompt'] }, 1, 0] } },
};

const toUsd = (credits: number) => Math.round((credits / CREDITS_PER_USD) * 1_000_000) / 1_000_000;

/** Aggregations over transactions, messages and conversations for the admin usage reports. */
export function createUsageMethods(mongoose: typeof import('mongoose')): {
  getUsageTotals: (window: UsageWindow) => Promise<TUsageTotals>;
  getUsageSeries: (
    window: UsageWindow,
    unit: TUsageGranularity,
    timeZone?: string,
  ) => Promise<TUsagePoint[]>;
  getUsageByModel: (window: UsageWindow, limit?: number) => Promise<TUsageByModel[]>;
  getUsageByUser: (window: UsageWindow, limit?: number) => Promise<TUsageByUser[]>;
  getUsageByAgent: (window: UsageWindow, limit?: number) => Promise<TUsageByAgent[]>;
  getUserUsageSnapshot: (
    userId: string,
    bounds: { dayStart: Date; monthStart: Date },
  ) => Promise<UserUsageSnapshot>;
  findAgentConversationIds: (agentId: string, window: UsageWindow) => Promise<string[]>;
} {
  const Transaction = () => mongoose.models.Transaction as Model<ITransaction>;
  const Message = () => mongoose.models.Message as Model<IMessage>;
  const Conversation = () => mongoose.models.Conversation as Model<IConversation>;
  const User = () => mongoose.models.User as Model<IUser>;
  const Agent = () => mongoose.models.Agent as Model<IAgent>;

  const toObjectIds = (ids: string[]) =>
    ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));

  function transactionMatch(window: UsageWindow): Record<string, unknown> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: window.from, $lt: window.to },
      tokenType: { $in: SPEND_TOKEN_TYPES },
    };
    if (window.userIds) {
      match.user = { $in: toObjectIds(window.userIds) };
    }
    if (window.model) {
      match.model = window.model;
    }
    if (window.conversationIds) {
      match.conversationId = { $in: window.conversationIds };
    }
    return match;
  }

  function messageMatch(window: UsageWindow): Record<string, unknown> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: window.from, $lt: window.to },
      isCreatedByUser: true,
    };
    if (window.userIds) {
      match.user = { $in: window.userIds };
    }
    if (window.conversationIds) {
      match.conversationId = { $in: window.conversationIds };
    }
    return match;
  }

  function conversationMatch(window: UsageWindow): Record<string, unknown> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: window.from, $lt: window.to },
    };
    if (window.userIds) {
      match.user = { $in: window.userIds };
    }
    if (window.conversationIds) {
      match.conversationId = { $in: window.conversationIds };
    }
    return match;
  }

  async function sumSpend(window: UsageWindow): Promise<SpendSums> {
    const [row] = await Transaction().aggregate<SpendSums>([
      { $match: transactionMatch(window) },
      { $group: { _id: null, ...spendAccumulators } },
    ]);
    return row ?? EMPTY_SUMS;
  }

  async function getUsageTotals(window: UsageWindow): Promise<TUsageTotals> {
    const [spend, messageStats, conversations] = await Promise.all([
      sumSpend(window),
      Message().aggregate<{ messages: number; activeUsers: number }>([
        { $match: messageMatch(window) },
        { $group: { _id: '$user', messages: { $sum: 1 } } },
        { $group: { _id: null, messages: { $sum: '$messages' }, activeUsers: { $sum: 1 } } },
      ]),
      Conversation().countDocuments(conversationMatch(window)),
    ]);
    const messages = messageStats[0];
    return {
      tokens: spend.promptTokens + spend.completionTokens,
      promptTokens: spend.promptTokens,
      completionTokens: spend.completionTokens,
      cost: toUsd(spend.credits),
      requests: spend.requests,
      messages: messages?.messages ?? 0,
      activeUsers: messages?.activeUsers ?? 0,
      conversations,
    };
  }

  async function getUsageSeries(
    window: UsageWindow,
    unit: TUsageGranularity,
    timeZone?: string,
  ): Promise<TUsagePoint[]> {
    const format = unit === 'month' ? '%Y-%m' : '%Y-%m-%d';
    const timezone = validTimeZone(timeZone);
    const dateKey = { $dateToString: { format, date: '$createdAt', timezone } };
    const [spendRows, messageRows] = await Promise.all([
      Transaction().aggregate<SpendSums & { _id: string }>([
        { $match: transactionMatch(window) },
        { $group: { _id: dateKey, ...spendAccumulators } },
      ]),
      Message().aggregate<{ _id: string; messages: number }>([
        { $match: messageMatch(window) },
        { $group: { _id: dateKey, messages: { $sum: 1 } } },
      ]),
    ]);

    const points = new Map<string, TUsagePoint>();
    for (const row of spendRows) {
      points.set(row._id, {
        date: row._id,
        tokens: row.promptTokens + row.completionTokens,
        cost: toUsd(row.credits),
        messages: 0,
      });
    }
    for (const row of messageRows) {
      const point = points.get(row._id);
      if (point) {
        point.messages = row.messages;
      } else {
        points.set(row._id, { date: row._id, tokens: 0, cost: 0, messages: row.messages });
      }
    }
    return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async function getUsageByModel(window: UsageWindow, limit = 20): Promise<TUsageByModel[]> {
    const rows = await Transaction().aggregate<SpendSums & { _id: string | null }>([
      { $match: transactionMatch(window) },
      { $group: { _id: '$model', ...spendAccumulators } },
      { $addFields: { tokens: { $add: ['$promptTokens', '$completionTokens'] } } },
      { $sort: { tokens: -1 } },
      { $limit: Math.min(limit, MAX_BREAKDOWN_ROWS) },
    ]);
    return rows.map((row) => ({
      model: row._id ?? '',
      tokens: row.promptTokens + row.completionTokens,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      cost: toUsd(row.credits),
      requests: row.requests,
    }));
  }

  async function getUsageByUser(window: UsageWindow, limit = 20): Promise<TUsageByUser[]> {
    const rows = await Transaction().aggregate<SpendSums & { _id: { toString(): string } }>([
      { $match: transactionMatch(window) },
      { $group: { _id: '$user', ...spendAccumulators } },
      { $addFields: { tokens: { $add: ['$promptTokens', '$completionTokens'] } } },
      { $sort: { tokens: -1 } },
      { $limit: Math.min(limit, MAX_BREAKDOWN_ROWS) },
    ]);
    if (rows.length === 0) {
      return [];
    }
    const userIds = rows.map((row) => row._id.toString());
    const [users, messageCounts] = await Promise.all([
      User()
        .find({ _id: { $in: toObjectIds(userIds) } }, 'name username email')
        .lean<
          Array<Pick<IUser, 'name' | 'username' | 'email'> & { _id: { toString(): string } }>
        >(),
      Message().aggregate<{ _id: string; messages: number }>([
        { $match: messageMatch({ ...window, userIds }) },
        { $group: { _id: '$user', messages: { $sum: 1 } } },
      ]),
    ]);
    const userById = new Map(users.map((user) => [user._id.toString(), user]));
    const messagesByUser = new Map(messageCounts.map((row) => [row._id, row.messages]));
    return rows.map((row) => {
      const id = row._id.toString();
      const user = userById.get(id);
      return {
        userId: id,
        name: user?.name || user?.username || '',
        email: user?.email ?? '',
        tokens: row.promptTokens + row.completionTokens,
        cost: toUsd(row.credits),
        messages: messagesByUser.get(id) ?? 0,
      };
    });
  }

  /**
   * Attributes spend to agents through the conversation each transaction belongs to.
   * A conversation that switched agents is attributed to its current agent.
   */
  async function getUsageByAgent(window: UsageWindow, limit = 20): Promise<TUsageByAgent[]> {
    const pipeline: PipelineStage[] = [
      { $match: { ...transactionMatch(window), conversationId: { $type: 'string' } } },
      {
        $group: {
          _id: { conversationId: '$conversationId', user: '$user' },
          ...spendAccumulators,
        },
      },
      {
        /** Joined per owner: a conversation id is unique only together with its user. */
        $lookup: {
          from: CONVERSATIONS_COLLECTION,
          localField: '_id.conversationId',
          foreignField: 'conversationId',
          let: { owner: { $toString: '$_id.user' } },
          as: 'conversation',
          pipeline: [
            { $match: { $expr: { $eq: ['$user', '$$owner'] } } },
            { $project: { _id: 0, agent_id: 1 } },
            { $limit: 1 },
          ],
        },
      },
      { $unwind: '$conversation' },
      { $match: { 'conversation.agent_id': { $regex: '^agent_' } } },
      {
        $group: {
          _id: '$conversation.agent_id',
          conversations: { $sum: 1 },
          promptTokens: { $sum: '$promptTokens' },
          completionTokens: { $sum: '$completionTokens' },
          credits: { $sum: '$credits' },
        },
      },
      { $addFields: { tokens: { $add: ['$promptTokens', '$completionTokens'] } } },
      { $sort: { tokens: -1 } },
      { $limit: Math.min(limit, MAX_BREAKDOWN_ROWS) },
    ];
    const rows = await Transaction().aggregate<
      Omit<SpendSums, 'requests'> & { _id: string; conversations: number }
    >(pipeline);
    if (rows.length === 0) {
      return [];
    }
    const agents = await Agent()
      .find({ id: { $in: rows.map((row) => row._id) } }, 'id name')
      .lean<Array<Pick<IAgent, 'id' | 'name'>>>();
    const nameById = new Map(agents.map((agent) => [agent.id, agent.name ?? '']));
    return rows.map((row) => ({
      agentId: row._id,
      name: nameById.get(row._id) ?? '',
      conversations: row.conversations,
      tokens: row.promptTokens + row.completionTokens,
      cost: toUsd(row.credits),
    }));
  }

  async function findAgentConversationIds(agentId: string, window: UsageWindow): Promise<string[]> {
    const filter: Record<string, unknown> = {
      agent_id: agentId,
      updatedAt: { $gte: window.from },
      createdAt: { $lt: window.to },
    };
    if (window.userIds) {
      filter.user = { $in: window.userIds };
    }
    const ids = await Conversation().distinct('conversationId', filter);
    return ids.filter((id): id is string => typeof id === 'string');
  }

  /** Tokens and messages a user consumed since the start of the current day and month. */
  async function getUserUsageSnapshot(
    userId: string,
    { dayStart, monthStart }: { dayStart: Date; monthStart: Date },
  ): Promise<UserUsageSnapshot> {
    if (!mongoose.isValidObjectId(userId)) {
      return { tokensToday: 0, tokensMonth: 0, messagesToday: 0, messagesMonth: 0 };
    }
    const since = dayStart < monthStart ? dayStart : monthStart;
    const inDay = { $gte: ['$createdAt', dayStart] };
    const inMonth = { $gte: ['$createdAt', monthStart] };
    const [tokens, messages] = await Promise.all([
      Transaction().aggregate<{ today: number; month: number }>([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            createdAt: { $gte: since },
            tokenType: { $in: SPEND_TOKEN_TYPES },
          },
        },
        {
          $group: {
            _id: null,
            today: { $sum: { $cond: [inDay, absAmount('$rawAmount'), 0] } },
            month: { $sum: { $cond: [inMonth, absAmount('$rawAmount'), 0] } },
          },
        },
      ]),
      Message().aggregate<{ today: number; month: number }>([
        { $match: { user: userId, isCreatedByUser: true, createdAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            today: { $sum: { $cond: [inDay, 1, 0] } },
            month: { $sum: { $cond: [inMonth, 1, 0] } },
          },
        },
      ]),
    ]);
    return {
      tokensToday: tokens[0]?.today ?? 0,
      tokensMonth: tokens[0]?.month ?? 0,
      messagesToday: messages[0]?.today ?? 0,
      messagesMonth: messages[0]?.month ?? 0,
    };
  }

  return {
    getUsageTotals,
    getUsageSeries,
    getUsageByModel,
    getUsageByUser,
    getUsageByAgent,
    getUserUsageSnapshot,
    findAgentConversationIds,
  };
}

export type UsageMethods = ReturnType<typeof createUsageMethods>;
