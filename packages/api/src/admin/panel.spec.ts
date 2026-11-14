import type { AdminPanelDeps } from './panel';
import {
  createAdminPanelHandlers,
  parseBalanceUpdate,
  parseNewAccount,
  parseSpendRange,
} from './panel';

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

function mockRes() {
  const res: { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

const USER_ID = '6650a1b2c3d4e5f6a7b8c9d0';

function makeDeps(overrides: Partial<AdminPanelDeps> = {}): AdminPanelDeps {
  return {
    countUsers: jest.fn().mockResolvedValue(3),
    findUsersByIds: jest.fn().mockResolvedValue([{ _id: USER_ID, email: 'a@example.com' }]),
    findUserIdByEmail: jest.fn().mockResolvedValue(null),
    createUser: jest.fn().mockResolvedValue({ _id: USER_ID, name: 'Ali', role: 'USER' }),
    getAppBalanceConfig: jest.fn().mockResolvedValue({ tokenCredits: 0 }),
    hashPassword: jest.fn().mockResolvedValue('hashed'),
    findBalance: jest.fn().mockResolvedValue({ tokenCredits: 500 }),
    upsertBalance: jest.fn().mockResolvedValue({ tokenCredits: 900 }),
    aggregateSpend: jest
      .fn()
      .mockResolvedValue([
        { key: null, spentCredits: 120, requests: 4, inputTokens: 300, outputTokens: 80 },
      ]),
    emitAudit: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as AdminPanelDeps;
}

describe('parseSpendRange', () => {
  it('defaults to the last 30 days', () => {
    const result = parseSpendRange({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const days = (result.value.to.getTime() - result.value.from.getTime()) / 86_400_000;
      expect(days).toBeCloseTo(30, 5);
    }
  });

  it('rejects reversed and oversized ranges', () => {
    expect(parseSpendRange({ from: '2026-02-01', to: '2026-01-01' }).ok).toBe(false);
    expect(parseSpendRange({ from: '2024-01-01', to: '2026-01-01' }).ok).toBe(false);
  });

  it('rejects unparseable dates', () => {
    expect(parseSpendRange({ from: 'not-a-date', to: '2026-01-01' }).ok).toBe(false);
  });
});

describe('parseNewAccount', () => {
  it('normalizes email, defaults name, and only grants ADMIN when requested', () => {
    const result = parseNewAccount({ email: ' Ali@Example.com ', password: 'longpass1' });
    expect(result).toEqual({
      ok: true,
      value: {
        email: 'ali@example.com',
        name: 'ali@example.com',
        password: 'longpass1',
        role: 'USER',
      },
    });
    const admin = parseNewAccount({ email: 'b@x.io', password: 'longpass1', role: 'ADMIN' });
    expect(admin.ok && admin.value.role).toBe('ADMIN');
  });

  it('rejects a short password and a malformed email', () => {
    expect(parseNewAccount({ email: 'a@b.co', password: 'short' }).ok).toBe(false);
    expect(parseNewAccount({ email: 'nope', password: 'longpass1' }).ok).toBe(false);
  });
});

describe('parseBalanceUpdate', () => {
  it('keeps only supplied fields and floors credits', () => {
    expect(parseBalanceUpdate({ tokenCredits: 1500.9 })).toEqual({
      ok: true,
      value: { tokenCredits: 1500 },
    });
  });

  it('rejects negative credits, bad intervals and empty bodies', () => {
    expect(parseBalanceUpdate({ tokenCredits: -1 }).ok).toBe(false);
    expect(parseBalanceUpdate({ refillIntervalValue: 0 }).ok).toBe(false);
    expect(parseBalanceUpdate({ refillIntervalUnit: 'fortnights' }).ok).toBe(false);
    expect(parseBalanceUpdate({}).ok).toBe(false);
  });
});

describe('createAdminPanelHandlers', () => {
  it('summary returns totals from the aggregate and the user count', async () => {
    const deps = makeDeps();
    const handlers = createAdminPanelHandlers(deps);
    const res = mockRes();
    await handlers.summary({ query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ users: 3, spentCredits: 120, requests: 4, inputTokens: 300 }),
    );
    expect(deps.aggregateSpend).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'none' }));
  });

  it('summary returns zeros when there is no spend', async () => {
    const handlers = createAdminPanelHandlers(
      makeDeps({ aggregateSpend: jest.fn().mockResolvedValue([]) }),
    );
    const res = mockRes();
    await handlers.summary({ query: {} } as never, res as never);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ spentCredits: 0, requests: 0 }),
    );
  });

  it('usage labels user rows by email and leaves unknown users null', async () => {
    const deps = makeDeps({
      aggregateSpend: jest.fn().mockResolvedValue([
        { key: USER_ID, spentCredits: 50, requests: 1, inputTokens: 10, outputTokens: 2 },
        {
          key: '6650a1b2c3d4e5f6a7b8c9d1',
          spentCredits: 5,
          requests: 1,
          inputTokens: 1,
          outputTokens: 1,
        },
      ]),
    });
    const handlers = createAdminPanelHandlers(deps);
    const res = mockRes();
    await handlers.usage({ query: { groupBy: 'user' } } as never, res as never);
    const body = res.json.mock.calls[0][0];
    expect(body.rows[0].label).toBe('a@example.com');
    expect(body.rows[1].label).toBeNull();
  });

  it('usage groups by model with the model name as its label', async () => {
    const deps = makeDeps({
      aggregateSpend: jest
        .fn()
        .mockResolvedValue([
          { key: 'gpt-4o', spentCredits: 9, requests: 1, inputTokens: 1, outputTokens: 1 },
        ]),
    });
    const handlers = createAdminPanelHandlers(deps);
    const res = mockRes();
    await handlers.usage({ query: { groupBy: 'model' } } as never, res as never);
    expect(res.json.mock.calls[0][0].rows[0].label).toBe('gpt-4o');
    expect(deps.findUsersByIds).not.toHaveBeenCalled();
  });

  it('createUser rejects an email already in use with 409 and does not create', async () => {
    const deps = makeDeps({ findUserIdByEmail: jest.fn().mockResolvedValue(USER_ID) });
    const handlers = createAdminPanelHandlers(deps);
    const res = mockRes();
    await handlers.createUser(
      { body: { email: 'a@example.com', password: 'longpass1' } } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it('createUser hashes the password, creates a verified account and audits it', async () => {
    const deps = makeDeps();
    const handlers = createAdminPanelHandlers(deps);
    const res = mockRes();
    const req = { body: { email: 'ali@example.com', password: 'longpass1' } };
    await handlers.createUser(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(201);
    const [data] = (deps.createUser as jest.Mock).mock.calls[0];
    expect(data).toEqual(expect.objectContaining({ emailVerified: true, password: 'hashed' }));
    expect(data.password).not.toBe('longpass1');
    expect(deps.emitAudit).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ action: 'user.created' }),
    );
  });

  it('getBalance rejects a malformed id without touching the database', async () => {
    const deps = makeDeps();
    const handlers = createAdminPanelHandlers(deps);
    const res = mockRes();
    await handlers.getBalance({ params: { id: '../etc' } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(deps.findBalance).not.toHaveBeenCalled();
  });

  it('updateBalance writes the validated fields and audits before and after', async () => {
    const deps = makeDeps();
    const handlers = createAdminPanelHandlers(deps);
    const res = mockRes();
    const req = { params: { id: USER_ID }, body: { tokenCredits: 900 } };
    await handlers.updateBalance(req as never, res as never);
    expect(deps.upsertBalance).toHaveBeenCalledWith(USER_ID, { tokenCredits: 900 });
    expect(deps.emitAudit).toHaveBeenCalledWith(
      req,
      expect.objectContaining({
        action: 'balance.updated',
        metadata: expect.objectContaining({ tokenCreditsBefore: 500, tokenCreditsAfter: 900 }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 500 with a generic message when the database fails', async () => {
    const handlers = createAdminPanelHandlers(
      makeDeps({ countUsers: jest.fn().mockRejectedValue(new Error('db down')) }),
    );
    const res = mockRes();
    await handlers.summary({ query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'failed to load summary' });
  });
});
