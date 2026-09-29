export type UsagePeriods = {
  dayStart: Date;
  dayEnd: Date;
  monthStart: Date;
  monthEnd: Date;
};

type LocalParts = { year: number; month: number; day: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

function localParts(date: Date, timeZone: string): LocalParts & { offsetMs: number } {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    offsetMs: asUtc - Math.floor(date.getTime() / 1000) * 1000,
  };
}

/** The instant local midnight of `parts` occurs in `timeZone`. */
function zonedMidnight({ year, month, day }: LocalParts, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - localParts(new Date(guess), timeZone).offsetMs;
  /** Re-read the offset at the candidate instant so DST transitions land correctly. */
  return new Date(guess - localParts(new Date(first), timeZone).offsetMs);
}

/** Day and month windows containing `now` in `timeZone` (falls back to UTC when invalid). */
export function getUsagePeriods(now: Date, timeZone: string): UsagePeriods {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const { year, month, day } = localParts(now, zone);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextMonth = new Date(Date.UTC(year, month, 1));
  return {
    dayStart: zonedMidnight({ year, month, day }, zone),
    dayEnd: zonedMidnight(
      {
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
      },
      zone,
    ),
    monthStart: zonedMidnight({ year, month, day: 1 }, zone),
    monthEnd: zonedMidnight(
      { year: nextMonth.getUTCFullYear(), month: nextMonth.getUTCMonth() + 1, day: 1 },
      zone,
    ),
  };
}
