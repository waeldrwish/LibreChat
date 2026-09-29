import { getUsagePeriods, isValidTimeZone } from './periods';

describe('getUsagePeriods', () => {
  it('uses UTC midnights for UTC', () => {
    const periods = getUsagePeriods(new Date('2026-09-29T23:30:00Z'), 'UTC');
    expect(periods.dayStart.toISOString()).toBe('2026-09-29T00:00:00.000Z');
    expect(periods.dayEnd.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(periods.monthStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(periods.monthEnd.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('starts the day at local midnight in a zone east of UTC', () => {
    /** 23:30 UTC on the 29th is 02:30 on the 30th in Riyadh (UTC+3). */
    const periods = getUsagePeriods(new Date('2026-09-29T23:30:00Z'), 'Asia/Riyadh');
    expect(periods.dayStart.toISOString()).toBe('2026-09-29T21:00:00.000Z');
    expect(periods.dayEnd.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(periods.monthStart.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(periods.monthEnd.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('handles a daylight-saving transition day', () => {
    /** Europe/Berlin switches to CEST (UTC+2) on 2026-03-29. */
    const periods = getUsagePeriods(new Date('2026-03-29T12:00:00Z'), 'Europe/Berlin');
    expect(periods.dayStart.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(periods.dayEnd.toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    const periods = getUsagePeriods(new Date('2026-09-29T10:00:00Z'), 'Mars/Olympus');
    expect(periods.dayStart.toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });
});
