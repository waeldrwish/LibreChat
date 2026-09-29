import type { UsageLimitRecord } from '@librechat/data-schemas';
import type { PrincipalSet } from './principals';
import { describeLimits, findExceededLimit, resolveEffectiveLimits } from './limits';
import { getUsagePeriods } from './periods';

const member: PrincipalSet = { userId: 'u1', role: 'EMPLOYEE', groupIds: ['g-small', 'g-big'] };

const record = (
  principalType: UsageLimitRecord['principalType'],
  principalId: string,
  limits: UsageLimitRecord['limits'],
): UsageLimitRecord => ({ principalType, principalId, limits });

describe('resolveEffectiveLimits', () => {
  it('is unlimited when nothing is configured', () => {
    const limits = resolveEffectiveLimits(member, [], {});
    expect(limits.tokensPerDay).toEqual({ limit: null, source: 'default' });
    expect(limits.messagesPerMonth).toEqual({ limit: null, source: 'default' });
  });

  it('resolves each metric by user, then most generous group, then role, then default', () => {
    const limits = resolveEffectiveLimits(
      member,
      [
        record('role', 'EMPLOYEE', { tokensPerDay: 1000, messagesPerDay: 10, tokensPerMonth: 5 }),
        record('group', 'g-small', { tokensPerDay: 2000 }),
        record('group', 'g-big', { tokensPerDay: 50_000 }),
        record('group', 'g-other', { messagesPerDay: 9999 }),
        record('user', 'u1', { tokensPerMonth: 300_000 }),
      ],
      { messagesPerMonth: 100 },
    );
    expect(limits.tokensPerDay).toEqual({ limit: 50_000, source: 'group' });
    expect(limits.messagesPerDay).toEqual({ limit: 10, source: 'role' });
    expect(limits.tokensPerMonth).toEqual({ limit: 300_000, source: 'user' });
    expect(limits.messagesPerMonth).toEqual({ limit: 100, source: 'default' });
  });

  it('treats -1 as an explicit "unlimited" that overrides a lower level', () => {
    const limits = resolveEffectiveLimits(
      member,
      [
        record('user', 'u1', { tokensPerDay: -1 }),
        record('role', 'EMPLOYEE', { tokensPerDay: 10 }),
      ],
      {},
    );
    expect(limits.tokensPerDay).toEqual({ limit: null, source: 'user' });

    const groupUnlimited = resolveEffectiveLimits(
      member,
      [
        record('group', 'g-small', { tokensPerDay: 10 }),
        record('group', 'g-big', { tokensPerDay: -1 }),
      ],
      {},
    );
    expect(groupUnlimited.tokensPerDay).toEqual({ limit: null, source: 'group' });
  });
});

describe('findExceededLimit', () => {
  const periods = getUsagePeriods(new Date('2026-03-15T12:00:00Z'), 'UTC');
  const usage = { tokensToday: 900, tokensMonth: 4000, messagesToday: 3, messagesMonth: 40 };

  it('returns null while every limit has room', () => {
    const limits = resolveEffectiveLimits(
      member,
      [record('user', 'u1', { tokensPerDay: 1000 })],
      {},
    );
    expect(findExceededLimit(limits, usage, periods)).toBeNull();
  });

  it('reports the reached metric with its reset time', () => {
    const limits = resolveEffectiveLimits(
      member,
      [record('user', 'u1', { tokensPerDay: 900, messagesPerMonth: 10 })],
      {},
    );
    const exceeded = findExceededLimit(limits, usage, periods);
    expect(exceeded).toEqual({
      metric: 'tokensPerDay',
      limit: 900,
      used: 900,
      resetAt: new Date('2026-03-16T00:00:00Z'),
    });
  });

  it('blocks immediately on a zero limit', () => {
    const limits = resolveEffectiveLimits(
      member,
      [record('group', 'g-big', { messagesPerMonth: 0 })],
      {},
    );
    const exceeded = findExceededLimit(
      limits,
      { tokensToday: 0, tokensMonth: 0, messagesToday: 0, messagesMonth: 0 },
      periods,
    );
    expect(exceeded?.metric).toBe('messagesPerMonth');
    expect(exceeded?.resetAt).toEqual(new Date('2026-04-01T00:00:00Z'));
  });

  it('describes limits with consumption for the admin panel', () => {
    const limits = resolveEffectiveLimits(
      member,
      [record('user', 'u1', { tokensPerDay: 1000 })],
      {},
    );
    expect(describeLimits(limits, usage)).toEqual([
      { metric: 'tokensPerDay', limit: 1000, used: 900, source: 'user' },
      { metric: 'tokensPerMonth', limit: null, used: 4000, source: 'default' },
      { metric: 'messagesPerDay', limit: null, used: 3, source: 'default' },
      { metric: 'messagesPerMonth', limit: null, used: 40, source: 'default' },
    ]);
  });
});
