import { useEffect, useState } from 'react';
import { Button, Dropdown, Input, Spinner } from '@librechat/client';
import { UNLIMITED_USAGE, USAGE_LIMIT_METRICS } from 'librechat-data-provider';
import type { TUsageLimits, UsageLimitMetric, TPrincipalAccess } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { Panel, SectionTitle, useAdminNotify } from '../common/ui';
import { useUpdateAdminAccessMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

export const METRIC_LABELS: Record<UsageLimitMetric, TranslationKeys> = {
  tokensPerDay: 'com_admin_limit_tokens_day',
  tokensPerMonth: 'com_admin_limit_tokens_month',
  messagesPerDay: 'com_admin_limit_messages_day',
  messagesPerMonth: 'com_admin_limit_messages_month',
};

type Mode = 'inherit' | 'unlimited' | 'custom';
export type LimitDraft = Record<UsageLimitMetric, { mode: Mode; value: string }>;

function toEntry(value: number | undefined): LimitDraft[UsageLimitMetric] {
  if (value == null) {
    return { mode: 'inherit', value: '' };
  }
  if (value === UNLIMITED_USAGE) {
    return { mode: 'unlimited', value: '' };
  }
  return { mode: 'custom', value: String(value) };
}

export function toLimitDraft(limits: TUsageLimits): LimitDraft {
  const draft = {} as LimitDraft;
  for (const metric of USAGE_LIMIT_METRICS) {
    draft[metric] = toEntry(limits[metric]);
  }
  return draft;
}

/** The limits a draft describes, or `null` when a custom value is not a non-negative integer. */
export function fromLimitDraft(draft: LimitDraft): TUsageLimits | null {
  const limits: TUsageLimits = {};
  for (const metric of USAGE_LIMIT_METRICS) {
    const { mode, value } = draft[metric];
    if (mode === 'unlimited') {
      limits[metric] = UNLIMITED_USAGE;
    } else if (mode === 'custom') {
      const parsed = Number(value);
      if (value.trim() === '' || !Number.isInteger(parsed) || parsed < 0) {
        return null;
      }
      limits[metric] = parsed;
    }
  }
  return limits;
}

/**
 * One inherit / unlimited / custom control per metric. `inheritLabelKey` names what
 * "inherit" falls through to (the next principal level, or "no limit" for defaults).
 */
export function LimitFields({
  draft,
  onChange,
  disabled,
  inheritLabelKey = 'com_admin_limit_inherit',
}: {
  draft: LimitDraft;
  onChange: (draft: LimitDraft) => void;
  disabled?: boolean;
  inheritLabelKey?: TranslationKeys;
}) {
  const localize = useLocalize();
  const modeOptions = [
    { value: 'inherit', label: localize(inheritLabelKey) },
    { value: 'unlimited', label: localize('com_admin_limit_unlimited') },
    { value: 'custom', label: localize('com_admin_limit_custom') },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {USAGE_LIMIT_METRICS.map((metric) => {
        const entry = draft[metric];
        const label = localize(METRIC_LABELS[metric]);
        return (
          <fieldset key={metric} className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm text-text-primary">{label}</legend>
            <div className="flex gap-2">
              <Dropdown
                variant="field"
                className="w-40 shrink-0"
                ariaLabel={label}
                disabled={disabled}
                value={entry.mode}
                options={modeOptions}
                onChange={(mode) =>
                  onChange({ ...draft, [metric]: { mode: mode as Mode, value: entry.value } })
                }
              />
              {entry.mode === 'custom' && (
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  dir="ltr"
                  disabled={disabled}
                  aria-label={label}
                  value={entry.value}
                  onChange={(event) =>
                    onChange({ ...draft, [metric]: { mode: 'custom', value: event.target.value } })
                  }
                />
              )}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * Usage limits set at this level. `inherit` falls through to the next level
 * (user → most generous group → role → default); `0` blocks new requests.
 */
export default function LimitsSection({
  access,
  principalType,
  canEdit,
}: {
  access: TPrincipalAccess;
  principalType: string;
  canEdit: boolean;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const mutation = useUpdateAdminAccessMutation();
  const [draft, setDraft] = useState<LimitDraft>(() => toLimitDraft(access.limits));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => setDraft(toLimitDraft(access.limits)), [access.limits]);

  const save = () => {
    const limits = fromLimitDraft(draft);
    setInvalid(limits == null);
    if (!limits) {
      return;
    }
    mutation.mutate(
      { principalType, principalId: access.principalId, body: { limits } },
      { onSuccess: () => notify.success(localize('com_admin_saved')), onError: notify.error },
    );
  };

  return (
    <Panel>
      <SectionTitle>{localize('com_admin_access_limits')}</SectionTitle>
      <p className="mb-4 text-sm text-text-secondary">
        {localize('com_admin_access_limits_description')}
      </p>
      <LimitFields draft={draft} onChange={setDraft} disabled={!canEdit} />
      {invalid && (
        <p role="alert" className="mt-3 text-sm text-text-destructive">
          {localize('com_admin_limit_invalid')}
        </p>
      )}
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={mutation.isLoading}>
            {mutation.isLoading ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        </div>
      )}
    </Panel>
  );
}
