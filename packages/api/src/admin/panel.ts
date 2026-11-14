import { logger } from '@librechat/data-schemas';
import { REFILL_INTERVAL_UNITS, SystemRoles } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminAuditEmitter } from './audit';
import { getSafeErrorMetadata } from '~/utils/errors';

/** Largest spend window the panel will aggregate, in days. */
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MIN_PASSWORD_LENGTH = 8;

export type SpendGroupBy = 'none' | 'user' | 'model';

export interface SpendRow {
  key: string | null;
  spentCredits: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface PanelBalance {
  tokenCredits?: number;
  autoRefillEnabled?: boolean;
  refillIntervalValue?: number;
  refillIntervalUnit?: string;
  refillAmount?: number;
}

export type PanelBalanceUpdate = PanelBalance;

export interface AdminPanelDeps {
  countUsers: () => Promise<number>;
  findUsersByIds: (
    ids: string[],
  ) => Promise<Array<{ _id: unknown; email?: string; username?: string; name?: string }>>;
  findUserIdByEmail: (email: string) => Promise<string | null>;
  createUser: (
    data: Record<string, unknown>,
    balanceConfig: unknown,
  ) => Promise<{ _id: unknown; name?: string; role?: string }>;
  getAppBalanceConfig: (role: string) => Promise<unknown>;
  hashPassword: (password: string) => Promise<string>;
  findBalance: (userId: string) => Promise<PanelBalance | null>;
  upsertBalance: (userId: string, fields: PanelBalanceUpdate) => Promise<PanelBalance | null>;
  aggregateSpend: (params: {
    from: Date;
    to: Date;
    groupBy: SpendGroupBy;
    limit?: number;
  }) => Promise<SpendRow[]>;
  emitAudit: AdminAuditEmitter;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface SpendRange {
  from: Date;
  to: Date;
}

/** Parses `from`/`to` query values into a bounded range, defaulting to the last 30 days. */
export function parseSpendRange(query: { from?: unknown; to?: unknown }): ParseResult<SpendRange> {
  const to = typeof query.to === 'string' && query.to ? new Date(query.to) : new Date();
  const from =
    typeof query.from === 'string' && query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, message: 'invalid date range' };
  }
  if (from > to || to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    return { ok: false, message: 'invalid date range' };
  }
  return { ok: true, value: { from, to } };
}

export function parseGroupBy(value: unknown): SpendGroupBy {
  return value === 'model' ? 'model' : 'user';
}

export interface NewAccountInput {
  email: string;
  name: string;
  password: string;
  role: 'USER' | 'ADMIN';
}

export function parseNewAccount(body: unknown): ParseResult<NewAccountInput> {
  const input = (body ?? {}) as Record<string, unknown>;
  if (typeof input.email !== 'string' || !EMAIL_RE.test(input.email.trim())) {
    return { ok: false, message: 'invalid email' };
  }
  if (typeof input.password !== 'string' || input.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  const email = input.email.trim().toLowerCase();
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : email;
  const role = input.role === SystemRoles.ADMIN ? 'ADMIN' : 'USER';
  return { ok: true, value: { email, name, password: input.password, role } };
}

const NON_NEGATIVE_INT_FIELDS = ['tokenCredits', 'refillAmount'] as const;

/** Validates a partial balance update; only fields present in the body are returned. */
export function parseBalanceUpdate(body: unknown): ParseResult<PanelBalanceUpdate> {
  const input = (body ?? {}) as Record<string, unknown>;
  const update: PanelBalanceUpdate = {};

  for (const key of NON_NEGATIVE_INT_FIELDS) {
    if (input[key] === undefined) {
      continue;
    }
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: `${key} must be a non-negative number` };
    }
    update[key] = Math.floor(n);
  }
  if (input.refillIntervalValue !== undefined) {
    const n = Number(input.refillIntervalValue);
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, message: 'refillIntervalValue must be a positive integer' };
    }
    update.refillIntervalValue = n;
  }
  if (input.refillIntervalUnit !== undefined) {
    if (!REFILL_INTERVAL_UNITS.includes(input.refillIntervalUnit as never)) {
      return { ok: false, message: 'invalid refillIntervalUnit' };
    }
    update.refillIntervalUnit = input.refillIntervalUnit as string;
  }
  if (input.autoRefillEnabled !== undefined) {
    update.autoRefillEnabled = input.autoRefillEnabled === true;
  }
  if (Object.keys(update).length === 0) {
    return { ok: false, message: 'no balance fields provided' };
  }
  return { ok: true, value: update };
}

function toBalanceView(balance: PanelBalance | null) {
  return {
    tokenCredits: balance?.tokenCredits ?? 0,
    autoRefillEnabled: balance?.autoRefillEnabled ?? false,
    refillIntervalValue: balance?.refillIntervalValue ?? 30,
    refillIntervalUnit: balance?.refillIntervalUnit ?? 'days',
    refillAmount: balance?.refillAmount ?? 0,
  };
}

export interface AdminPanelHandlers {
  summary: (req: ServerRequest, res: Response) => Promise<Response>;
  usage: (req: ServerRequest, res: Response) => Promise<Response>;
  createUser: (req: ServerRequest, res: Response) => Promise<Response>;
  getBalance: (req: ServerRequest, res: Response) => Promise<Response>;
  updateBalance: (req: ServerRequest, res: Response) => Promise<Response>;
}

export function createAdminPanelHandlers(deps: AdminPanelDeps): AdminPanelHandlers {
  async function summary(req: ServerRequest, res: Response) {
    const range = parseSpendRange(req.query as { from?: unknown; to?: unknown });
    if (!range.ok) {
      return res.status(400).json({ message: range.message });
    }
    try {
      const [users, [totals]] = await Promise.all([
        deps.countUsers(),
        deps.aggregateSpend({ ...range.value, groupBy: 'none' }).then((rows) => [rows[0]]),
      ]);
      return res.status(200).json({
        users,
        range: { from: range.value.from, to: range.value.to },
        spentCredits: totals?.spentCredits ?? 0,
        requests: totals?.requests ?? 0,
        inputTokens: totals?.inputTokens ?? 0,
      });
    } catch (error) {
      logger.error('[adminPanel] summary failed', getSafeErrorMetadata(error));
      return res.status(500).json({ message: 'failed to load summary' });
    }
  }

  async function usage(req: ServerRequest, res: Response) {
    const range = parseSpendRange(req.query as { from?: unknown; to?: unknown });
    if (!range.ok) {
      return res.status(400).json({ message: range.message });
    }
    const groupBy = parseGroupBy(req.query.groupBy);
    try {
      const rows = await deps.aggregateSpend({ ...range.value, groupBy, limit: 500 });
      let labels: Record<string, string> = {};
      const labelFor = (key: string | null) => (key ? (labels[key] ?? null) : null);
      if (groupBy === 'user') {
        const ids = rows.map((r) => r.key).filter((k): k is string => !!k);
        const users = ids.length ? await deps.findUsersByIds(ids) : [];
        labels = Object.fromEntries(
          users.map((u) => [String(u._id), u.email ?? u.username ?? u.name ?? String(u._id)]),
        );
      }
      return res.status(200).json({
        groupBy,
        range: { from: range.value.from, to: range.value.to },
        rows: rows.map((row) => ({
          ...row,
          label: groupBy === 'user' ? labelFor(row.key) : (row.key ?? null),
        })),
      });
    } catch (error) {
      logger.error('[adminPanel] usage failed', getSafeErrorMetadata(error));
      return res.status(500).json({ message: 'failed to load usage' });
    }
  }

  async function createUser(req: ServerRequest, res: Response) {
    const parsed = parseNewAccount(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }
    const { email, name, password, role } = parsed.value;
    try {
      if (await deps.findUserIdByEmail(email)) {
        return res.status(409).json({ message: 'email already in use' });
      }
      const balanceConfig = await deps.getAppBalanceConfig(role);
      const user = await deps.createUser(
        {
          provider: 'local',
          email,
          username: email.split('@')[0],
          name,
          avatar: null,
          role,
          emailVerified: true,
          password: await deps.hashPassword(password),
        },
        balanceConfig,
      );
      const id = String(user._id);
      await deps.emitAudit(req, {
        action: 'user.created',
        outcome: 'success',
        target: { type: 'user', id, name: email },
      });
      return res.status(201).json({ id, email, name: user.name ?? name, role: user.role ?? role });
    } catch (error) {
      logger.error('[adminPanel] create user failed', getSafeErrorMetadata(error));
      return res.status(500).json({ message: 'failed to create user' });
    }
  }

  async function getBalance(req: ServerRequest, res: Response) {
    const userId = String((req.params as { id?: unknown }).id ?? '');
    if (!OBJECT_ID_RE.test(userId)) {
      return res.status(400).json({ message: 'invalid user id' });
    }
    try {
      return res.status(200).json(toBalanceView(await deps.findBalance(userId)));
    } catch (error) {
      logger.error('[adminPanel] get balance failed', getSafeErrorMetadata(error));
      return res.status(500).json({ message: 'failed to load balance' });
    }
  }

  async function updateBalance(req: ServerRequest, res: Response) {
    const userId = String((req.params as { id?: unknown }).id ?? '');
    if (!OBJECT_ID_RE.test(userId)) {
      return res.status(400).json({ message: 'invalid user id' });
    }
    const parsed = parseBalanceUpdate(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }
    try {
      const before = await deps.findBalance(userId);
      const updated = await deps.upsertBalance(userId, parsed.value);
      await deps.emitAudit(req, {
        action: 'balance.updated',
        outcome: 'success',
        target: { type: 'user', id: userId },
        metadata: {
          tokenCreditsBefore: before?.tokenCredits ?? 0,
          tokenCreditsAfter: updated?.tokenCredits ?? 0,
          changed: Object.keys(parsed.value).join(','),
        },
      });
      return res.status(200).json(toBalanceView(updated));
    } catch (error) {
      logger.error('[adminPanel] update balance failed', getSafeErrorMetadata(error));
      return res.status(500).json({ message: 'failed to update balance' });
    }
  }

  return { summary, usage, createUser, getBalance, updateBalance };
}
