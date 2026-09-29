import { useEffect, useMemo, useState } from 'react';
import { modelKey } from 'librechat-data-provider';
import { Button, Spinner } from '@librechat/client';
import type { TModelCatalog, TPrincipalAccess } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminModelCatalogQuery, useUpdateAdminAccessMutation } from '~/data-provider';
import { Panel, QueryState, SectionTitle, useAdminNotify } from '../common/ui';
import { SearchBox } from '../common/controls';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type Effect = 'inherit' | 'allow' | 'deny';

const EFFECTS: { value: Effect; labelKey: TranslationKeys }[] = [
  { value: 'inherit', labelKey: 'com_admin_access_inherit' },
  { value: 'allow', labelKey: 'com_admin_access_allow' },
  { value: 'deny', labelKey: 'com_admin_access_deny' },
];

/** A three-way segmented control; arrow keys follow the document direction via native radios. */
export function EffectToggle({
  name,
  value,
  onChange,
  label,
  disabled,
}: {
  name: string;
  value: Effect;
  onChange: (value: Effect) => void;
  label: string;
  disabled?: boolean;
}) {
  const localize = useLocalize();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border border-border-light p-0.5"
    >
      {EFFECTS.map((effect) => (
        <label
          key={effect.value}
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-text-primary',
            value === effect.value
              ? 'bg-surface-active font-medium text-text-primary'
              : 'text-text-secondary hover:text-text-primary',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={effect.value}
            checked={value === effect.value}
            disabled={disabled}
            onChange={() => onChange(effect.value)}
          />
          {localize(effect.labelKey)}
        </label>
      ))}
    </div>
  );
}

function ModelGrid({
  catalog,
  access,
  principalType,
  canEdit,
}: {
  catalog: TModelCatalog;
  access: TPrincipalAccess;
  principalType: string;
  canEdit: boolean;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const mutation = useUpdateAdminAccessMutation();
  const [search, setSearch] = useState('');
  const [effects, setEffects] = useState<Map<string, Effect>>(new Map());

  useEffect(() => {
    const next = new Map<string, Effect>();
    access.allowedModels.forEach((key) => next.set(key, 'allow'));
    access.deniedModels.forEach((key) => next.set(key, 'deny'));
    setEffects(next);
  }, [access]);

  const entries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalog.entries.filter(
      (entry) =>
        entry.available &&
        (!term ||
          entry.model.toLowerCase().includes(term) ||
          entry.endpoint.toLowerCase().includes(term)),
    );
  }, [catalog.entries, search]);

  const byEndpoint = useMemo(() => {
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) {
      const list = groups.get(entry.endpoint) ?? [];
      list.push(entry);
      groups.set(entry.endpoint, list);
    }
    return [...groups];
  }, [entries]);

  const save = () => {
    const allowedModels: string[] = [];
    const deniedModels: string[] = [];
    effects.forEach((effect, key) => {
      if (effect === 'allow') allowedModels.push(key);
      if (effect === 'deny') deniedModels.push(key);
    });
    mutation.mutate(
      {
        principalType,
        principalId: access.principalId,
        body: { allowedModels, deniedModels },
      },
      {
        onSuccess: () => notify.success(localize('com_admin_saved')),
        onError: notify.error,
      },
    );
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={localize('com_admin_models_search')}
        />
        <p className="text-xs text-text-secondary">
          {localize(
            catalog.defaultPolicy === 'allow'
              ? 'com_admin_models_default_allow'
              : 'com_admin_models_default_deny',
          )}
        </p>
      </div>
      {byEndpoint.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">
          {localize('com_admin_no_results')}
        </p>
      ) : (
        <div className="max-h-[28rem] space-y-4 overflow-y-auto pe-1">
          {byEndpoint.map(([endpoint, list]) => (
            <section key={endpoint} aria-label={endpoint}>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-text-secondary">
                {endpoint}
              </h3>
              <ul className="divide-y divide-border-light rounded-lg border border-border-light">
                {list.map((entry) => {
                  const key = modelKey(entry.endpoint, entry.model);
                  return (
                    <li
                      key={key}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm" dir="ltr">
                        {entry.model}
                        {entry.policy?.enabled === false && (
                          <span className="ms-2 text-xs text-text-secondary">
                            ({localize('com_admin_disabled')})
                          </span>
                        )}
                      </span>
                      <EffectToggle
                        name={key}
                        label={entry.model}
                        disabled={!canEdit}
                        value={effects.get(key) ?? 'inherit'}
                        onChange={(effect) =>
                          setEffects((current) => {
                            const next = new Map(current);
                            if (effect === 'inherit') {
                              next.delete(key);
                            } else {
                              next.set(key, effect);
                            }
                            return next;
                          })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={mutation.isLoading}>
            {mutation.isLoading ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        </div>
      )}
    </>
  );
}

/** Per-principal model grants: allow or deny a model at this level, or inherit it. */
export default function ModelAccessSection({
  access,
  principalType,
  canEdit,
}: {
  access: TPrincipalAccess;
  principalType: string;
  canEdit: boolean;
}) {
  const localize = useLocalize();
  const catalog = useAdminModelCatalogQuery();
  return (
    <Panel>
      <SectionTitle>{localize('com_admin_access_models')}</SectionTitle>
      <p className="mb-3 text-sm text-text-secondary">
        {localize('com_admin_access_models_description')}
      </p>
      <QueryState query={catalog}>
        {(data) => (
          <ModelGrid
            catalog={data}
            access={access}
            principalType={principalType}
            canEdit={canEdit}
          />
        )}
      </QueryState>
    </Panel>
  );
}
