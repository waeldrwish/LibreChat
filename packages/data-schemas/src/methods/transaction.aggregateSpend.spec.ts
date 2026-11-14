import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { matchModelName, findMatchingPattern } from './test-helpers';
import { createTransactionMethods } from './transaction';
import { createModels } from '~/models';
import { createTxMethods } from './tx';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let aggregateSpend: ReturnType<typeof createTransactionMethods>['aggregateSpend'];
let rawTransactions: mongoose.mongo.Collection;

const USER_A = new mongoose.Types.ObjectId();
const USER_B = new mongoose.Types.ObjectId();
const JAN_10 = new Date('2026-01-10T12:00:00Z');
const JAN_20 = new Date('2026-01-20T12:00:00Z');
const FEB_05 = new Date('2026-02-05T12:00:00Z');

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  Object.assign(mongoose.models, createModels(mongoose));

  const tx = createTxMethods(mongoose, { matchModelName, findMatchingPattern });
  aggregateSpend = createTransactionMethods(mongoose, {
    getMultiplier: tx.getMultiplier,
    getCacheMultiplier: tx.getCacheMultiplier,
  }).aggregateSpend;
  rawTransactions = mongoose.connection.collection('transactions');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await rawTransactions.deleteMany({});
  // Bypass mongoose timestamps so createdAt controls the date-range cases.
  await rawTransactions.insertMany([
    // User A, January: a prompt and a completion for gpt-4o, plus one refill (positive).
    {
      user: USER_A,
      model: 'gpt-4o',
      tokenType: 'prompt',
      rawAmount: -100,
      tokenValue: -300,
      createdAt: JAN_10,
    },
    {
      user: USER_A,
      model: 'gpt-4o',
      tokenType: 'completion',
      rawAmount: -40,
      tokenValue: -200,
      createdAt: JAN_10,
    },
    {
      user: USER_A,
      model: 'gpt-4o',
      tokenType: 'credits',
      rawAmount: 0,
      tokenValue: 5000,
      createdAt: JAN_20,
    },
    // User B, January: a prompt for claude on a different model.
    {
      user: USER_B,
      model: 'claude-sonnet',
      tokenType: 'prompt',
      rawAmount: -50,
      tokenValue: -150,
      createdAt: JAN_20,
    },
    // User A, February: outside a January window.
    {
      user: USER_A,
      model: 'gpt-4o',
      tokenType: 'prompt',
      rawAmount: -999,
      tokenValue: -2997,
      createdAt: FEB_05,
    },
  ]);
});

describe('aggregateSpend', () => {
  const january = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-31T23:59:59Z') };

  it('returns one totals row for groupBy none, excluding refills and out-of-range rows', async () => {
    const [totals] = await aggregateSpend({ ...january, groupBy: 'none' });
    expect(totals).toEqual({
      key: null,
      spentCredits: 300 + 200 + 150,
      requests: 2,
      inputTokens: 100 + 50,
      outputTokens: 40,
    });
  });

  it('groups by user, sorted by spend descending', async () => {
    const rows = await aggregateSpend({ ...january, groupBy: 'user' });
    expect(rows.map((r) => r.key)).toEqual([USER_A.toString(), USER_B.toString()]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        spentCredits: 500,
        requests: 1,
        inputTokens: 100,
        outputTokens: 40,
      }),
    );
    expect(rows[1].spentCredits).toBe(150);
  });

  it('groups by model', async () => {
    const rows = await aggregateSpend({ ...january, groupBy: 'model' });
    expect(rows.map((r) => [r.key, r.spentCredits])).toEqual([
      ['gpt-4o', 500],
      ['claude-sonnet', 150],
    ]);
  });

  it('honours the limit', async () => {
    const rows = await aggregateSpend({ ...january, groupBy: 'user', limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(USER_A.toString());
  });

  it('returns no rows for a window with no spend', async () => {
    const rows = await aggregateSpend({
      from: new Date('2025-01-01T00:00:00Z'),
      to: new Date('2025-01-31T00:00:00Z'),
      groupBy: 'none',
    });
    expect(rows).toEqual([]);
  });
});
