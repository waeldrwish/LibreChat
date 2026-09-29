import { useMemo } from 'react';
import { useAdmin } from '../context';

/** Locale-aware formatters for the panel's language (Arabic digits and separators included). */
export function useAdminFormat() {
  const { locale } = useAdmin();
  return useMemo(() => {
    const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const compact = new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    const currency = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    });
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
    const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    const day = new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const month = new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const list = new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' });
    const toDate = (value?: string | Date) => (value ? new Date(value) : undefined);
    return {
      locale,
      number: (value: number) => integer.format(value),
      compact: (value: number) => compact.format(value),
      list: (items: string[]) => list.format(items),
      currency: (value: number) => currency.format(value),
      date: (value?: string | Date) => {
        const parsed = toDate(value);
        return parsed ? date.format(parsed) : '—';
      },
      dateTime: (value?: string | Date) => {
        const parsed = toDate(value);
        return parsed ? dateTime.format(parsed) : '—';
      },
      /** Series keys are `YYYY-MM-DD` or `YYYY-MM`, already in the report's time zone. */
      seriesLabel: (key: string) =>
        key.length === 7
          ? month.format(new Date(`${key}-01T00:00:00Z`))
          : day.format(new Date(`${key}T00:00:00Z`)),
    };
  }, [locale]);
}

export type AdminFormat = ReturnType<typeof useAdminFormat>;

/** The viewer's IANA time zone, used for day and month buckets. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

type ApiError = { response?: { status?: number; data?: { error?: unknown } } };

/** The HTTP status and server detail of a failed admin API call. */
export function readApiError(error: unknown): { status?: number; detail?: string } {
  const response = (error as ApiError | undefined)?.response;
  const detail = response?.data?.error;
  return { status: response?.status, detail: typeof detail === 'string' ? detail : undefined };
}
