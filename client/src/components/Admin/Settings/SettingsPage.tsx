import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { ADMIN_PANEL_LANGUAGE_USER } from 'librechat-data-provider';
import { Input, Label, Button, Switch, Spinner, Dropdown } from '@librechat/client';
import type { TAdminSettings, TGovernanceConfig } from 'librechat-data-provider';
import type { LimitDraft } from '../access/LimitsSection';
import { PageHeader, Panel, QueryState, SectionTitle, useAdminNotify } from '../common/ui';
import { useAdminSettingsQuery, useUpdateAdminSettingsMutation } from '~/data-provider';
import { LimitFields, fromLimitDraft, toLimitDraft } from '../access/LimitsSection';
import { ConfirmDialog, Field } from '../common/controls';
import { Cap, useAdmin } from '../context';
import { useLocalize } from '~/hooks';

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function Flag({ on, label }: { on: boolean; label: string }) {
  const localize = useLocalize();
  return (
    <li className="flex items-center justify-between gap-2 py-2 text-sm">
      <span>{label}</span>
      <span className="inline-flex items-center gap-1 text-text-secondary">
        {on ? (
          <Check className="size-4 text-status-success" aria-hidden="true" />
        ) : (
          <X className="size-4" aria-hidden="true" />
        )}
        {localize(on ? 'com_admin_enabled' : 'com_admin_disabled')}
      </span>
    </li>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="mt-1 text-xs text-text-secondary">{hint}</p>}
      </div>
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function SettingsForm({ data }: { data: TAdminSettings }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const { can } = useAdmin();
  const canEdit = can(Cap.MANAGE_CONFIGS);
  const save = useUpdateAdminSettingsMutation();
  const [settings, setSettings] = useState<TGovernanceConfig>(data.governance);
  const [limitDraft, setLimitDraft] = useState<LimitDraft>(() =>
    toLimitDraft(data.governance.limits.defaults),
  );
  const [error, setError] = useState<string>();
  const [confirmDisable, setConfirmDisable] = useState(false);

  const patch = (next: Partial<TGovernanceConfig>) =>
    setSettings((current) => ({ ...current, ...next }));

  const submit = () => {
    const defaults = fromLimitDraft(limitDraft);
    if (!defaults) {
      setError(localize('com_admin_limit_invalid'));
      return;
    }
    if (!isValidTimeZone(settings.limits.timeZone)) {
      setError(localize('com_admin_settings_timezone_invalid'));
      return;
    }
    setError(undefined);
    save.mutate(
      { ...settings, limits: { ...settings.limits, defaults } },
      {
        onSuccess: () => {
          notify.success(localize('com_admin_saved'));
          setConfirmDisable(false);
        },
        onError: notify.error,
      },
    );
  };

  const requestSave = () => {
    if (data.governance.adminPanel.enabled && !settings.adminPanel.enabled) {
      setConfirmDisable(true);
      return;
    }
    submit();
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <SectionTitle>{localize('com_admin_settings_panel')}</SectionTitle>
        <div className="flex flex-col gap-4">
          <SwitchRow
            id="settings-panel-enabled"
            label={localize('com_admin_settings_panel_enabled')}
            hint={localize('com_admin_settings_panel_enabled_hint')}
            checked={settings.adminPanel.enabled}
            disabled={!canEdit}
            onChange={(enabled) => patch({ adminPanel: { ...settings.adminPanel, enabled } })}
          />
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <Label>{localize('com_admin_settings_language')}</Label>
            <Dropdown
              variant="field"
              ariaLabel={localize('com_admin_settings_language')}
              disabled={!canEdit}
              value={settings.adminPanel.language}
              onChange={(language) => patch({ adminPanel: { ...settings.adminPanel, language } })}
              options={[
                { value: 'ar', label: localize('com_admin_language_ar') },
                { value: 'en', label: localize('com_admin_language_en') },
                { value: ADMIN_PANEL_LANGUAGE_USER, label: localize('com_admin_language_user') },
              ]}
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>{localize('com_admin_settings_models')}</SectionTitle>
        <div className="flex flex-col gap-1.5 sm:max-w-md">
          <Label>{localize('com_admin_models_default_policy')}</Label>
          <Dropdown
            variant="field"
            ariaLabel={localize('com_admin_models_default_policy')}
            disabled={!canEdit}
            value={settings.models.defaultPolicy}
            onChange={(value) =>
              patch({ models: { defaultPolicy: value === 'deny' ? 'deny' : 'allow' } })
            }
            options={[
              { value: 'allow', label: localize('com_admin_default_policy_allow') },
              { value: 'deny', label: localize('com_admin_default_policy_deny') },
            ]}
          />
          <p className="text-xs text-text-secondary">
            {localize('com_admin_settings_default_policy_hint')}
          </p>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>{localize('com_admin_settings_usage')}</SectionTitle>
        <div className="flex flex-col gap-4">
          <SwitchRow
            id="settings-limits-enabled"
            label={localize('com_admin_settings_limits_enabled')}
            hint={localize('com_admin_settings_limits_enabled_hint')}
            checked={settings.limits.enabled}
            disabled={!canEdit}
            onChange={(enabled) => patch({ limits: { ...settings.limits, enabled } })}
          />
          <Field
            label={localize('com_admin_settings_timezone')}
            hint={localize('com_admin_settings_timezone_hint')}
          >
            {(id, describedBy) => (
              <Input
                id={id}
                dir="ltr"
                className="sm:max-w-xs"
                aria-describedby={describedBy}
                disabled={!canEdit}
                value={settings.limits.timeZone}
                onChange={(event) =>
                  patch({ limits: { ...settings.limits, timeZone: event.target.value } })
                }
              />
            )}
          </Field>
          <div>
            <p className="mb-3 text-sm font-medium text-text-primary">
              {localize('com_admin_limits_defaults')}
            </p>
            <LimitFields
              draft={limitDraft}
              onChange={setLimitDraft}
              disabled={!canEdit}
              inheritLabelKey="com_admin_limit_none"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={localize('com_admin_settings_policy_cache')}
              hint={localize('com_admin_settings_seconds_hint')}
            >
              {(id, describedBy) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={3600}
                  dir="ltr"
                  aria-describedby={describedBy}
                  disabled={!canEdit}
                  value={settings.policyCacheSeconds}
                  onChange={(event) =>
                    patch({ policyCacheSeconds: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              )}
            </Field>
            <Field
              label={localize('com_admin_settings_usage_cache')}
              hint={localize('com_admin_settings_seconds_hint')}
            >
              {(id, describedBy) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={600}
                  dir="ltr"
                  aria-describedby={describedBy}
                  disabled={!canEdit}
                  value={settings.usageCacheSeconds}
                  onChange={(event) =>
                    patch({ usageCacheSeconds: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              )}
            </Field>
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>{localize('com_admin_settings_auth')}</SectionTitle>
        <p className="mb-2 text-sm text-text-secondary">
          {localize('com_admin_settings_auth_hint')}
        </p>
        <ul className="divide-y divide-border-light">
          <Flag on={data.auth.emailLoginEnabled} label={localize('com_admin_auth_email_login')} />
          <Flag
            on={data.auth.registrationEnabled}
            label={localize('com_admin_auth_registration')}
          />
          <Flag
            on={data.auth.passwordResetEnabled}
            label={localize('com_admin_auth_password_reset')}
          />
          <Flag on={data.auth.openidEnabled} label={localize('com_admin_auth_openid')} />
          <Flag on={data.auth.samlEnabled} label={localize('com_admin_auth_saml')} />
          <Flag on={data.auth.ldapEnabled} label={localize('com_admin_auth_ldap')} />
          <Flag on={data.balance.enabled} label={localize('com_admin_auth_balance')} />
          <Flag on={data.transactions.enabled} label={localize('com_admin_auth_transactions')} />
        </ul>
        {!data.transactions.enabled && (
          <p className="mt-3 text-sm text-text-warning">
            {localize('com_admin_transactions_off_warning')}
          </p>
        )}
      </Panel>

      {error && (
        <p role="alert" className="text-sm text-text-destructive">
          {error}
        </p>
      )}
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={requestSave} disabled={save.isLoading}>
            {save.isLoading ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        title={localize('com_admin_settings_panel_disable')}
        description={localize('com_admin_settings_panel_disable_confirm')}
        confirmLabel={localize('com_admin_settings_panel_disable')}
        destructive={true}
        isLoading={save.isLoading}
        onConfirm={submit}
      />
    </div>
  );
}

export default function SettingsPage() {
  const localize = useLocalize();
  const settings = useAdminSettingsQuery();
  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_settings')}
        description={localize('com_admin_settings_description')}
      />
      <QueryState query={settings}>{(data) => <SettingsForm data={data} />}</QueryState>
    </>
  );
}
