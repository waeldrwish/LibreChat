import { useState } from 'react';
import { KeyRound, Puzzle, Settings2 } from 'lucide-react';
import {
  Button,
  Switch,
  Spinner,
  OGDialog,
  SecretInput,
  OGDialogTemplate,
} from '@librechat/client';
import type {
  TAdminTool,
  TAdminToolCredential,
  TToolCredentialSource,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { Empty, Panel, PageHeader, QueryState, useAdminNotify } from '../common/ui';
import { useAdminToolsQuery, useUpdateAdminToolMutation } from '~/data-provider';
import ImageSettingsDialog from './ImageSettingsDialog';
import { Field } from '../common/controls';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const SOURCE_LABELS: Record<TToolCredentialSource, TranslationKeys> = {
  env: 'com_admin_tool_key_env',
  system: 'com_admin_tool_key_system',
  user: 'com_admin_tool_key_user',
  missing: 'com_admin_tool_key_missing',
};

function SourceBadge({ credential }: { credential: TAdminToolCredential }) {
  const localize = useLocalize();
  const ready = credential.source === 'env' || credential.source === 'system';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
        ready
          ? 'border-border-light text-text-primary'
          : 'border-border-medium bg-surface-tertiary text-text-secondary',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', ready ? 'bg-status-success' : 'bg-status-neutral')}
      />
      <span dir="ltr">{credential.label}</span>
      <span>· {localize(SOURCE_LABELS[credential.source])}</span>
    </span>
  );
}

function KeysDialog({ tool, onClose }: { tool: TAdminTool; onClose: () => void }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const update = useUpdateAdminToolMutation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const changes = Object.fromEntries([
    ...Object.entries(values)
      .filter(([, value]) => value.trim() !== '')
      .map(([field, value]) => [field, value.trim()]),
    ...[...removed].map((field) => [field, null]),
  ]) as Record<string, string | null>;
  const hasChanges = Object.keys(changes).length > 0;

  const save = () =>
    update.mutate(
      { key: tool.key, update: { credentials: changes } },
      {
        onSuccess: () => {
          notify.success(localize('com_admin_saved'));
          onClose();
        },
        onError: notify.error,
      },
    );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_admin_tool_keys_title', { 0: tool.name })}
        className="max-w-lg"
        main={
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">{localize('com_admin_tool_keys_intro')}</p>
            {tool.credentials.map((credential) => {
              const fromEnv = credential.source === 'env';
              const isRemoved = removed.has(credential.field);
              return (
                <Field
                  key={credential.field}
                  label={credential.label}
                  hint={
                    fromEnv
                      ? localize('com_admin_tool_key_env_hint')
                      : localize(SOURCE_LABELS[credential.source])
                  }
                >
                  {(id, describedBy) => (
                    <div className="flex items-center gap-2">
                      <SecretInput
                        id={id}
                        dir="ltr"
                        autoComplete="off"
                        disabled={fromEnv || isRemoved}
                        aria-describedby={describedBy}
                        placeholder={credential.field}
                        value={values[credential.field] ?? ''}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [credential.field]: event.target.value,
                          }))
                        }
                      />
                      {credential.source === 'system' && (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-pressed={isRemoved}
                          onClick={() =>
                            setRemoved((current) => {
                              const next = new Set(current);
                              if (isRemoved) {
                                next.delete(credential.field);
                              } else {
                                next.add(credential.field);
                              }
                              return next;
                            })
                          }
                        >
                          {localize(
                            isRemoved ? 'com_admin_tool_key_keep' : 'com_admin_tool_key_remove',
                          )}
                        </Button>
                      )}
                    </div>
                  )}
                </Field>
              );
            })}
          </div>
        }
        selection={
          <Button onClick={save} disabled={!hasChanges || update.isLoading}>
            {update.isLoading ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}

function ToolRow({ tool, canManage }: { tool: TAdminTool; canManage: boolean }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const update = useUpdateAdminToolMutation();
  const [editingKeys, setEditingKeys] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);

  const toggle = (enabled: boolean) =>
    update.mutate(
      { key: tool.key, update: { enabled } },
      {
        onSuccess: () =>
          notify.success(localize(enabled ? 'com_admin_tool_enabled' : 'com_admin_tool_disabled')),
        onError: notify.error,
      },
    );

  return (
    <li className="flex flex-wrap items-start gap-3 py-4">
      {tool.icon ? (
        <img src={tool.icon} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary">
          <Puzzle className="size-5 text-text-secondary" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <span className="block font-medium text-text-primary">{tool.name}</span>
        {tool.description && (
          <span className="line-clamp-2 text-sm text-text-secondary">{tool.description}</span>
        )}
        {tool.imageSettings && (
          <span className="mt-1 block text-xs text-text-secondary">
            {localize('com_admin_tool_image_model_current', { 0: tool.imageSettings.model })}
          </span>
        )}
        {tool.credentials.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tool.credentials.map((credential) => (
              <SourceBadge key={credential.field} credential={credential} />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {canManage && tool.imageSettings && (
          <Button variant="outline" size="sm" onClick={() => setEditingSettings(true)}>
            <Settings2 className="size-4" aria-hidden="true" />
            {localize('com_admin_tool_settings')}
          </Button>
        )}
        {canManage && tool.credentials.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setEditingKeys(true)}>
            <KeyRound className="size-4" aria-hidden="true" />
            {localize('com_admin_tool_keys')}
          </Button>
        )}
        <Switch
          aria-label={localize('com_admin_tool_enabled_label', { 0: tool.name })}
          checked={tool.enabled}
          disabled={!canManage || update.isLoading}
          onCheckedChange={toggle}
        />
      </div>
      {editingKeys && <KeysDialog tool={tool} onClose={() => setEditingKeys(false)} />}
      {editingSettings && tool.imageSettings && (
        <ImageSettingsDialog
          toolKey={tool.key}
          toolName={tool.name}
          settings={tool.imageSettings}
          onClose={() => setEditingSettings(false)}
        />
      )}
    </li>
  );
}

export default function ToolsPage() {
  const localize = useLocalize();
  const tools = useAdminToolsQuery();

  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_tools')}
        description={localize('com_admin_tools_description')}
      />
      <Panel>
        <QueryState
          query={tools}
          isEmpty={(data) => data.tools.length === 0}
          empty={<Empty icon={Puzzle} title={localize('com_admin_tools_empty')} />}
        >
          {(data) => (
            <ul className="divide-y divide-border-light">
              {data.tools.map((tool) => (
                <ToolRow key={tool.key} tool={tool} canManage={data.canManage} />
              ))}
            </ul>
          )}
        </QueryState>
      </Panel>
    </>
  );
}
