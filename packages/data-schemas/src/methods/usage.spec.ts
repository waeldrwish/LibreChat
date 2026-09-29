import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createGovernanceMethods } from './governance';
import { createDirectoryMethods } from './directory';
import { createUsageMethods } from './usage';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: MongoMemoryServer;
let usage: ReturnType<typeof createUsageMethods>;
let directory: ReturnType<typeof createDirectoryMethods>;
let governance: ReturnType<typeof createGovernanceMethods>;

const DAY = new Date('2026-09-29T00:00:00Z');
const MONTH = new Date('2026-09-01T00:00:00Z');
const at = (iso: string) => new Date(iso);

let aliceId: string;
let bobId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  usage = createUsageMethods(mongoose);
  directory = createDirectoryMethods(mongoose);
  governance = createGovernanceMethods(mongoose);

  const { User, Transaction, Message, Conversation, Agent } = mongoose.models;
  const [alice, bob] = await User.create([
    { email: 'alice@example.com', name: 'Alice', provider: 'local' },
    { email: 'bob@example.com', name: 'Bob', provider: 'local', disabled: true },
  ]);
  aliceId = alice._id.toString();
  bobId = bob._id.toString();

  await Agent.create({
    id: 'agent_hr',
    name: 'HR Assistant',
    provider: 'openAI',
    model: 'gpt-4o',
    author: alice._id,
  });
  await Conversation.create([
    {
      conversationId: 'c-hr',
      endpoint: 'agents',
      user: aliceId,
      agent_id: 'agent_hr',
      createdAt: at('2026-09-29T08:00:00Z'),
    },
    {
      conversationId: 'c-plain',
      endpoint: 'anthropic',
      user: bobId,
      createdAt: at('2026-09-10T08:00:00Z'),
    },
  ]);

  const tx = (
    user: mongoose.Types.ObjectId,
    conversationId: string,
    tokenType: string,
    tokens: number,
    createdAt: string,
    model = 'gpt-4o',
  ) => ({
    user,
    conversationId,
    tokenType,
    model,
    rawAmount: -tokens,
    tokenValue: -tokens * 2,
    createdAt: at(createdAt),
  });
  await Transaction.insertMany([
    tx(alice._id, 'c-hr', 'prompt', 100, '2026-09-29T09:00:00Z'),
    tx(alice._id, 'c-hr', 'completion', 50, '2026-09-29T09:00:01Z'),
    tx(alice._id, 'c-hr', 'prompt', 1000, '2026-09-05T09:00:00Z'),
    tx(bob._id, 'c-plain', 'prompt', 400, '2026-09-10T09:00:00Z', 'claude-opus'),
    tx(bob._id, 'c-plain', 'completion', 600, '2026-09-10T09:00:01Z', 'claude-opus'),
    {
      user: alice._id,
      tokenType: 'credits',
      rawAmount: 100_000,
      createdAt: at('2026-09-29T10:00:00Z'),
    },
    tx(alice._id, 'c-hr', 'prompt', 7, '2026-08-31T23:59:59Z'),
  ]);

  const message = (
    user: string,
    conversationId: string,
    createdAt: string,
    isCreatedByUser = true,
  ) => ({
    messageId: `${conversationId}-${createdAt}-${isCreatedByUser}`,
    conversationId,
    user,
    isCreatedByUser,
    createdAt: at(createdAt),
  });
  await Message.insertMany([
    message(aliceId, 'c-hr', '2026-09-29T09:00:00Z'),
    message(aliceId, 'c-hr', '2026-09-29T09:00:01Z', false),
    message(aliceId, 'c-hr', '2026-09-05T09:00:00Z'),
    message(bobId, 'c-plain', '2026-09-10T09:00:00Z'),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('usage methods', () => {
  const september = { from: MONTH, to: at('2026-10-01T00:00:00Z') };

  it("counts a user's tokens and own messages for the current day and month", async () => {
    await expect(
      usage.getUserUsageSnapshot(aliceId, { dayStart: DAY, monthStart: MONTH }),
    ).resolves.toEqual({ tokensToday: 150, tokensMonth: 1150, messagesToday: 1, messagesMonth: 2 });
  });

  it('totals spend while ignoring credit refills and other windows', async () => {
    const totals = await usage.getUsageTotals(september);
    expect(totals).toEqual({
      tokens: 2150,
      promptTokens: 1500,
      completionTokens: 650,
      cost: 0.0043,
      requests: 3,
      messages: 3,
      activeUsers: 2,
      conversations: 2,
    });
  });

  it('restricts totals to a set of users', async () => {
    const totals = await usage.getUsageTotals({ ...september, userIds: [bobId] });
    expect(totals).toMatchObject({ tokens: 1000, messages: 1, activeUsers: 1 });
  });

  it('breaks usage down by model, user and agent', async () => {
    const [byModel, byUser, byAgent] = await Promise.all([
      usage.getUsageByModel(september),
      usage.getUsageByUser(september),
      usage.getUsageByAgent(september),
    ]);
    expect(byModel.map(({ model, tokens }) => ({ model, tokens }))).toEqual([
      { model: 'gpt-4o', tokens: 1150 },
      { model: 'claude-opus', tokens: 1000 },
    ]);
    expect(byUser.map(({ name, tokens, messages }) => ({ name, tokens, messages }))).toEqual([
      { name: 'Alice', tokens: 1150, messages: 2 },
      { name: 'Bob', tokens: 1000, messages: 1 },
    ]);
    expect(byAgent).toEqual([
      { agentId: 'agent_hr', name: 'HR Assistant', conversations: 1, tokens: 1150, cost: 0.0023 },
    ]);
  });

  it('builds a daily series in the requested time zone', async () => {
    const series = await usage.getUsageSeries(september, 'day', 'UTC');
    expect(series).toEqual([
      { date: '2026-09-05', tokens: 1000, cost: 0.002, messages: 1 },
      { date: '2026-09-10', tokens: 1000, cost: 0.002, messages: 1 },
      { date: '2026-09-29', tokens: 150, cost: 0.0003, messages: 1 },
    ]);
  });

  it("finds an agent's conversations for filtering", async () => {
    await expect(usage.findAgentConversationIds('agent_hr', september)).resolves.toEqual(['c-hr']);
  });
});

describe('directory methods', () => {
  it('filters users by status and search', async () => {
    const disabled = await directory.listAdminUsers({ status: 'disabled', limit: 10, offset: 0 });
    expect(disabled.users.map((user) => user.email)).toEqual(['bob@example.com']);

    const search = await directory.listAdminUsers({ search: 'ALI', limit: 10, offset: 0 });
    expect(search.total).toBe(1);
    await expect(directory.countAdminUsers()).resolves.toEqual({ total: 2, disabled: 1 });
  });

  it('resolves group members stored by user id or external id', async () => {
    const { Group, User } = mongoose.models;
    await User.updateOne({ _id: bobId }, { idOnTheSource: 'entra-bob' });
    const group = await Group.create({
      name: 'Finance',
      source: 'local',
      memberIds: [aliceId, 'entra-bob'],
      managerIds: [aliceId],
    });
    const members = await directory.getGroupMemberUserIds([group._id.toString()]);
    expect(members.sort()).toEqual([aliceId, bobId].sort());
    await expect(directory.findManagedGroupIds(aliceId)).resolves.toEqual([group._id.toString()]);

    const users = await directory.listAdminUsers({ limit: 10, offset: 0 });
    const groups = await directory.listGroupsForUsers(users.users);
    expect(groups.get(bobId)).toEqual([{ id: group._id.toString(), name: 'Finance' }]);
  });

  it('disables an agent without creating a version', async () => {
    const before = await mongoose.models.Agent.findOne({ id: 'agent_hr' }).lean<{
      versions: unknown[];
    }>();
    const updated = await directory.setAgentDisabled('agent_hr', true);
    expect(updated?.disabled).toBe(true);
    await expect(directory.isAgentDisabled('agent_hr')).resolves.toBe(true);
    const after = await mongoose.models.Agent.findOne({ id: 'agent_hr' }).lean<{
      versions: unknown[];
    }>();
    expect(after?.versions.length).toBe(before?.versions.length);

    await directory.setAgentDisabled('agent_hr', false);
    await expect(directory.isAgentDisabled('agent_hr')).resolves.toBe(false);
  });
});

describe('governance methods', () => {
  it("replaces a principal's model grants and cascades on deletion", async () => {
    await governance.createModelPolicy({
      endpoint: 'openAI',
      model: 'gpt-4o',
      enabled: true,
      access: 'restricted',
      grants: [{ principalType: 'role', principalId: 'USER', effect: 'allow' }],
    });
    const principal = { principalType: 'group' as const, principalId: 'group-1' };

    await governance.setPrincipalModelGrants({
      principal,
      allowedModels: ['openAI|gpt-4o', 'anthropic|claude-opus'],
      deniedModels: [],
    });
    await governance.setPrincipalModelGrants({
      principal,
      allowedModels: ['anthropic|claude-opus'],
      deniedModels: ['openAI|gpt-4o'],
    });

    const policies = await governance.listModelPolicies();
    const gpt = policies.find((policy) => policy.model === 'gpt-4o');
    const opus = policies.find((policy) => policy.model === 'claude-opus');
    expect(gpt?.access).toBe('restricted');
    expect(gpt?.grants).toEqual([
      { principalType: 'role', principalId: 'USER', effect: 'allow' },
      { principalType: 'group', principalId: 'group-1', effect: 'deny' },
    ]);
    expect(opus).toMatchObject({ access: 'inherit', enabled: true });
    expect(opus?.grants).toEqual([
      { principalType: 'group', principalId: 'group-1', effect: 'allow' },
    ]);

    await governance.setUsageLimits({ principal, limits: { tokensPerDay: 500 } });
    await governance.deletePrincipalGovernance('group', 'group-1');
    const after = await governance.listModelPolicies();
    expect(after.flatMap((policy) => policy.grants)).toEqual([
      { principalType: 'role', principalId: 'USER', effect: 'allow' },
    ]);
    await expect(governance.findUsageLimitsForPrincipals([principal])).resolves.toEqual([]);
  });

  it('stores only explicit limits and removes a principal with none left', async () => {
    const principal = { principalType: 'user' as const, principalId: aliceId };
    const stored = await governance.setUsageLimits({
      principal,
      limits: { tokensPerDay: 1000, messagesPerDay: undefined, tokensPerMonth: -1 },
    });
    expect(stored?.limits).toEqual({ tokensPerDay: 1000, tokensPerMonth: -1 });

    await governance.setUsageLimits({ principal, limits: {} });
    await expect(governance.findUsageLimitsForPrincipals([principal])).resolves.toEqual([]);
  });
});
