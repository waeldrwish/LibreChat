import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { TAccessSource, TEffectiveAccess } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { Panel, QueryState, SectionTitle } from '../common/ui';
import { useAdminEffectiveAccessQuery } from '~/data-provider';
import { useAdminFormat } from '../common/format';
import { METRIC_LABELS } from './LimitsSection';
import { SearchBox } from '../common/controls';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export const SOURCE_LABELS: Record<TAccessSource, TranslationKeys> = {
  user: 'com_admin_source_user',
  group: 'com_admin_source_group',
  role: 'com_admin_source_role',
  policy: 'com_admin_source_policy',
  default: 'com_admin_source_default',
};

function Content({ data }: { data: TEffectiveAccess }) {
  const localize = useLocalize();
  const format = useAdminFormat();
  const [search, setSearch] = useState('');
  const models = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.models
      .filter((model) => !term || model.model.toLowerCase().includes(term))
      .sort((a, b) => Number(b.allowed) - Number(a.allowed));
  }, [data.models, search]);
  const allowedCount = data.models.filter((model) => model.allowed).length;

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <SectionTitle>{localize('com_admin_effective_limits')}</SectionTitle>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.limits.map((limit) => {
            const ratio = limit.limit ? Math.min(1, limit.used / limit.limit) : 0;
            return (
              <li key={limit.metric}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-text-primary">{localize(METRIC_LABELS[limit.metric])}</span>
                  <span className="tabular-nums text-text-secondary">
                    {limit.limit == null
                      ? localize('com_admin_used_unlimited', { 0: format.number(limit.used) })
                      : localize('com_admin_used_of', {
                          0: format.number(limit.used),
                          1: format.number(limit.limit),
                        })}
                  </span>
                </div>
                {limit.limit != null && (
                  <div
                    className="mt-1.5 h-1.5 w-full rounded-full bg-surface-tertiary"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={limit.limit}
                    aria-valuenow={limit.used}
                    aria-label={localize(METRIC_LABELS[limit.metric])}
                  >
                    <div
                      className={cn(
                        'h-full rounded-full bg-series-1',
                        ratio >= 0.8 && 'bg-status-warning',
                        ratio >= 1 && 'bg-status-error',
                      )}
                      style={{ width: `${Math.max(ratio * 100, limit.used > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                )}
                <p className="mt-1 text-xs text-text-secondary">
                  {localize('com_admin_from_source', { 0: localize(SOURCE_LABELS[limit.source]) })}
                </p>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel>
        <SectionTitle>
          {localize('com_admin_effective_models', {
            0: format.number(allowedCount),
            1: format.number(data.models.length),
          })}
        </SectionTitle>
        <div className="mb-3">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={localize('com_admin_models_search')}
          />
        </div>
        <ul className="max-h-96 divide-y divide-border-light overflow-y-auto rounded-lg border border-border-light">
          {models.map((model) => (
            <li
              key={`${model.endpoint}|${model.model}`}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                {model.allowed ? (
                  <Check className="size-4 shrink-0 text-status-success" aria-hidden="true" />
                ) : (
                  <X className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                )}
                <span className="sr-only">
                  {localize(model.allowed ? 'com_admin_allowed' : 'com_admin_blocked')}
                </span>
                <span className="truncate" dir="ltr">
                  {model.model}
                </span>
                <span className="text-xs text-text-secondary">{model.endpoint}</span>
              </span>
              <span className="shrink-0 text-xs text-text-secondary">
                {localize(SOURCE_LABELS[model.source])}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** What a user can actually use after user, group, role and default settings combine. */
export default function EffectiveAccess({ userId }: { userId: string }) {
  const query = useAdminEffectiveAccessQuery(userId);
  return <QueryState query={query}>{(data) => <Content data={data} />}</QueryState>;
}
