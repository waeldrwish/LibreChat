import { useId, useState } from 'react';
import { cn } from '~/utils';

export type SeriesDatum = { key: string; label: string; value: number; display: string };

/**
 * A single-series column chart over time (magnitude, one hue). Columns follow the
 * document direction, so an RTL panel reads oldest-to-newest from the right. Each
 * column is a full-height hit target with a tooltip; a visually hidden table carries
 * the same numbers for screen readers.
 */
export function SeriesBars({
  data,
  title,
  height = 160,
}: {
  data: SeriesDatum[];
  title: string;
  height?: number;
}) {
  const [active, setActive] = useState<number>();
  const tableId = useId();
  const max = Math.max(1, ...data.map((datum) => datum.value));
  const activeDatum = active == null ? undefined : data[active];
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <figure className="m-0">
      <div
        className="relative flex items-end gap-0.5 border-b border-border-medium"
        style={{ height }}
        role="img"
        aria-label={title}
        aria-describedby={tableId}
        onMouseLeave={() => setActive(undefined)}
      >
        {data.map((datum, index) => (
          <button
            type="button"
            key={datum.key}
            className="group relative flex h-full min-w-0 flex-1 items-end focus-visible:outline-none"
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(undefined)}
            aria-label={`${datum.label}: ${datum.display}`}
          >
            <span
              className={cn(
                'block w-full rounded-t bg-series-1 transition-opacity duration-theme-fast motion-reduce:transition-none',
                active != null && active !== index && 'opacity-50',
                'group-focus-visible:ring-2 group-focus-visible:ring-text-primary',
              )}
              style={{ height: `${Math.max(datum.value > 0 ? 2 : 0, (datum.value / max) * 100)}%` }}
            />
          </button>
        ))}
        {activeDatum && active != null && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border-light bg-surface-primary px-2.5 py-1.5 text-xs text-text-primary shadow-lg rtl:translate-x-1/2"
            style={{
              insetInlineStart: `${Math.max(8, Math.min(92, ((active + 0.5) / data.length) * 100))}%`,
            }}
          >
            <span className="text-text-secondary">{activeDatum.label}</span>{' '}
            <strong className="tabular-nums">{activeDatum.display}</strong>
          </div>
        )}
      </div>
      <div className="mt-1 flex gap-0.5 text-[11px] text-text-secondary" aria-hidden="true">
        {data.map((datum, index) => (
          <span key={datum.key} className="min-w-0 flex-1 truncate text-center">
            {index % labelEvery === 0 ? datum.label : ''}
          </span>
        ))}
      </div>
      <table id={tableId} className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key}>
              <th scope="row">{datum.label}</th>
              <td>{datum.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export type RankDatum = {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  display: string;
};

/** Ranked magnitudes as labeled horizontal bars; each row states its value, so no hover is needed. */
export function RankList({ data, emptyLabel }: { data: RankDatum[]; emptyLabel: string }) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-text-secondary">{emptyLabel}</p>;
  }
  const max = Math.max(1, ...data.map((datum) => datum.value));
  return (
    <ol className="space-y-3">
      {data.map((datum) => (
        <li key={datum.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-text-primary" title={datum.label}>
              {datum.label}
              {datum.sublabel && (
                <span className="ms-2 text-xs text-text-secondary">{datum.sublabel}</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-text-secondary">{datum.display}</span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-surface-tertiary" aria-hidden="true">
            <div
              className="h-full rounded-full bg-series-1"
              style={{ width: `${Math.max(1, (datum.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
