import { useState } from 'react';
import { Pencil, Plus, Server, Trash2 } from 'lucide-react';
import {
  Input,
  Label,
  Button,
  Switch,
  Spinner,
  OGDialog,
  Textarea,
  SecretInput,
  OGDialogTemplate,
} from '@librechat/client';
import type { TManagedProvider, TProviders } from 'librechat-data-provider';
import {
  Empty,
  Panel,
  PageHeader,
  QueryState,
  StatusBadge,
  SectionTitle,
  useAdminNotify,
} from '../common/ui';
import { useAdminProvidersQuery, useUpdateAdminProvidersMutation } from '~/data-provider';
import { ConfirmDialog, Field } from '../common/controls';
import { useAdminFormat } from '../common/format';
import { useLocalize } from '~/hooks';

const NAME = /^[\w .-]{1,64}$/;

type Draft = {
  name: string;
  baseURL: string;
  apiKey: string;
  models: string;
  fetch: boolean;
  titleConvo: boolean;
  titleModel: string;
  modelDisplayLabel: string;
};

function toDraft(provider?: TManagedProvider): Draft {
  return {
    name: provider?.name ?? '',
    baseURL: provider?.baseURL ?? '',
    apiKey: '',
    models: provider?.models.default.join('\n') ?? '',
    fetch: provider?.models.fetch === true,
    titleConvo: provider?.titleConvo === true,
    titleModel: provider?.titleModel ?? '',
    modelDisplayLabel: provider?.modelDisplayLabel ?? '',
  };
}

/** The write shape: the stored key is kept unless a new one is typed. */
function toProvider(draft: Draft, existing?: TManagedProvider): TManagedProvider {
  const models = draft.models
    .split(/[\n,]/)
    .map((model) => model.trim())
    .filter(Boolean);
  const apiKey = draft.apiKey.trim();
  return {
    name: draft.name.trim(),
    baseURL: draft.baseURL.trim(),
    models: { default: models, fetch: draft.fetch },
    ...(apiKey || !existing ? { apiKey } : {}),
    ...(draft.titleConvo ? { titleConvo: true } : {}),
    ...(draft.titleModel.trim() ? { titleModel: draft.titleModel.trim() } : {}),
    ...(draft.modelDisplayLabel.trim()
      ? { modelDisplayLabel: draft.modelDisplayLabel.trim() }
      : {}),
    ...(existing?.iconURL ? { iconURL: existing.iconURL } : {}),
  };
}

/** Strips read-only fields so an untouched provider round-trips with its stored key. */
const toWrite = (provider: TManagedProvider): TManagedProvider => {
  const { apiKeyPreview: _preview, apiKey: _key, ...rest } = provider;
  return rest;
};

function ProviderDialog({
  open,
  provider,
  onOpenChange,
  onSave,
  isSaving,
}: {
  open: boolean;
  provider?: TManagedProvider;
  onOpenChange: (open: boolean) => void;
  onSave: (provider: TManagedProvider) => void;
  isSaving: boolean;
}) {
  const localize = useLocalize();
  const [draft, setDraft] = useState<Draft>(() => toDraft(provider));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const nameValid = NAME.test(draft.name.trim());
  const valid =
    nameValid &&
    /^https?:\/\//i.test(draft.baseURL.trim()) &&
    (draft.models.trim().length > 0 || draft.fetch) &&
    (provider != null || draft.apiKey.trim().length > 0);

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize(provider ? 'com_admin_provider_edit' : 'com_admin_provider_add')}
        className="max-w-xl"
        mainClassName="max-h-[70vh] overflow-y-auto"
        main={
          <div className="flex flex-col gap-4">
            <Field
              label={localize('com_admin_field_name')}
              hint={localize('com_admin_provider_name_hint')}
            >
              {(id, describedBy) => (
                <Input
                  id={id}
                  dir="ltr"
                  disabled={provider != null}
                  aria-describedby={describedBy}
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              )}
            </Field>
            <Field label={localize('com_admin_provider_base_url')}>
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  placeholder="https://api.example.com/v1"
                  value={draft.baseURL}
                  onChange={(e) => set('baseURL', e.target.value)}
                />
              )}
            </Field>
            <Field
              label={localize('com_admin_provider_api_key')}
              hint={
                provider?.apiKeyPreview
                  ? localize('com_admin_provider_api_key_keep', { 0: provider.apiKeyPreview })
                  : localize('com_admin_provider_api_key_hint')
              }
            >
              {(id, describedBy) => (
                <SecretInput
                  id={id}
                  dir="ltr"
                  autoComplete="off"
                  aria-describedby={describedBy}
                  value={draft.apiKey}
                  onChange={(e) => set('apiKey', e.target.value)}
                />
              )}
            </Field>
            <Field
              label={localize('com_admin_provider_models')}
              hint={localize('com_admin_provider_models_hint')}
            >
              {(id, describedBy) => (
                <Textarea
                  id={id}
                  dir="ltr"
                  rows={4}
                  aria-describedby={describedBy}
                  value={draft.models}
                  onChange={(e) => set('models', e.target.value)}
                />
              )}
            </Field>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="provider-fetch">{localize('com_admin_provider_fetch')}</Label>
              <Switch
                id="provider-fetch"
                aria-label={localize('com_admin_provider_fetch')}
                checked={draft.fetch}
                onCheckedChange={(checked) => set('fetch', checked)}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={localize('com_admin_provider_display_label')}>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.modelDisplayLabel}
                    onChange={(e) => set('modelDisplayLabel', e.target.value)}
                  />
                )}
              </Field>
              <Field label={localize('com_admin_provider_title_model')}>
                {(id) => (
                  <Input
                    id={id}
                    dir="ltr"
                    value={draft.titleModel}
                    onChange={(e) => set('titleModel', e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="provider-title">{localize('com_admin_provider_title_convo')}</Label>
              <Switch
                id="provider-title"
                aria-label={localize('com_admin_provider_title_convo')}
                checked={draft.titleConvo}
                onCheckedChange={(checked) => set('titleConvo', checked)}
              />
            </div>
          </div>
        }
        selection={
          <Button onClick={() => onSave(toProvider(draft, provider))} disabled={!valid || isSaving}>
            {isSaving ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}

function Providers({ data }: { data: TProviders }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const format = useAdminFormat();
  const save = useUpdateAdminProvidersMutation();
  const [editing, setEditing] = useState<{ provider?: TManagedProvider } | null>(null);
  const [removing, setRemoving] = useState<TManagedProvider | null>(null);

  const persist = (providers: TManagedProvider[], onDone: () => void) =>
    save.mutate(providers, {
      onSuccess: () => {
        notify.success(localize('com_admin_saved'));
        onDone();
      },
      onError: notify.error,
    });

  const upsert = (provider: TManagedProvider) => {
    const others = data.managed.filter((item) => item.name !== provider.name).map(toWrite);
    persist([...others, provider], () => setEditing(null));
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <SectionTitle
          actions={
            data.canManage && (
              <Button size="sm" onClick={() => setEditing({})}>
                <Plus className="size-4" aria-hidden="true" />
                {localize('com_admin_provider_add')}
              </Button>
            )
          }
        >
          {localize('com_admin_providers_managed')}
        </SectionTitle>
        <p className="mb-3 text-sm text-text-secondary">
          {localize('com_admin_providers_managed_description')}
        </p>
        {data.managed.length === 0 ? (
          <Empty icon={Server} title={localize('com_admin_providers_managed_empty')} />
        ) : (
          <ul className="divide-y divide-border-light">
            {data.managed.map((provider) => (
              <li
                key={provider.name}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <span className="block font-medium" dir="ltr">
                    {provider.name}
                  </span>
                  <span className="block truncate text-xs text-text-secondary" dir="ltr">
                    {provider.baseURL}
                  </span>
                  <span className="block text-xs text-text-secondary">
                    {localize('com_admin_models_count', {
                      0: format.number(provider.models.default.length),
                    })}
                    {provider.models.fetch
                      ? ` · ${localize('com_admin_provider_fetch_short')}`
                      : ''}
                  </span>
                </div>
                {data.canManage && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={localize('com_admin_edit')}
                      onClick={() => setEditing({ provider })}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={localize('com_admin_delete')}
                      onClick={() => setRemoving(provider)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <SectionTitle>{localize('com_admin_providers_builtin')}</SectionTitle>
        <p className="mb-3 text-sm text-text-secondary">
          {localize('com_admin_providers_builtin_description')}
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.builtIn.map((provider) => (
            <li
              key={provider.name}
              className="flex items-center justify-between gap-2 rounded-lg border border-border-light px-3 py-2"
            >
              <div className="min-w-0">
                <span className="block text-sm font-medium" dir="ltr">
                  {provider.name}
                </span>
                <span className="text-xs text-text-secondary">
                  {provider.userProvide
                    ? localize('com_admin_provider_user_key')
                    : localize('com_admin_models_count', { 0: format.number(provider.models) })}
                </span>
              </div>
              <StatusBadge
                active={provider.enabled}
                label={localize(
                  provider.enabled ? 'com_admin_enabled' : 'com_admin_not_configured',
                )}
              />
            </li>
          ))}
        </ul>
      </Panel>

      {data.configured.length > 0 && (
        <Panel>
          <SectionTitle>{localize('com_admin_providers_configured')}</SectionTitle>
          <p className="mb-3 text-sm text-text-secondary">
            {localize('com_admin_providers_configured_description')}
          </p>
          <ul className="divide-y divide-border-light">
            {data.configured.map((provider) => (
              <li key={provider.name} className="py-2">
                <span className="text-sm font-medium" dir="ltr">
                  {provider.name}
                </span>
                <span className="ms-2 text-xs text-text-secondary" dir="ltr">
                  {provider.baseURL}
                </span>
                <span className="ms-2 text-xs text-text-secondary">
                  {localize('com_admin_models_count', { 0: format.number(provider.models) })}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {editing && (
        <ProviderDialog
          key={editing.provider?.name ?? 'new'}
          open={true}
          provider={editing.provider}
          isSaving={save.isLoading}
          onOpenChange={(open) => !open && setEditing(null)}
          onSave={upsert}
        />
      )}
      <ConfirmDialog
        open={removing != null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={localize('com_admin_provider_delete')}
        description={localize('com_admin_provider_delete_confirm', { 0: removing?.name ?? '' })}
        confirmLabel={localize('com_admin_delete')}
        destructive={true}
        isLoading={save.isLoading}
        onConfirm={() =>
          persist(data.managed.filter((item) => item.name !== removing?.name).map(toWrite), () =>
            setRemoving(null),
          )
        }
      />
    </div>
  );
}

export default function ProvidersPage() {
  const localize = useLocalize();
  const providers = useAdminProvidersQuery();
  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_providers')}
        description={localize('com_admin_providers_description')}
      />
      <QueryState query={providers}>{(data) => <Providers data={data} />}</QueryState>
    </>
  );
}
