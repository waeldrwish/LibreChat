import { useState } from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import {
  Input,
  Label,
  Button,
  Spinner,
  Dropdown,
  OGDialog,
  Textarea,
  MultiSelect,
  OGDialogTemplate,
} from '@librechat/client';
import type { Agent, AgentModelParameters, TAdminAgent } from 'librechat-data-provider';
import {
  useCreateAgentMutation,
  useUpdateAgentMutation,
  useAdminAgentToolsQuery,
  useAdminModelCatalogQuery,
  useGetExpandedAgentByIdQuery,
} from '~/data-provider';
import { useAdminNotify } from '../common/ui';
import { Field } from '../common/controls';
import { useLocalize } from '~/hooks';

type Draft = {
  name: string;
  description: string;
  instructions: string;
  provider: string;
  model: string;
  tools: string[];
};

function AgentForm({ agent, onClose }: { agent?: Agent; onClose: () => void }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const queryClient = useQueryClient();
  const catalog = useAdminModelCatalogQuery();
  const tools = useAdminAgentToolsQuery();
  const [draft, setDraft] = useState<Draft>({
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    instructions: agent?.instructions ?? '',
    provider: agent?.provider ?? '',
    model: agent?.model ?? '',
    tools: (agent?.tools ?? []).filter((tool): tool is string => typeof tool === 'string'),
  });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries([QueryKeys.adminAgents]),
      queryClient.invalidateQueries([QueryKeys.adminOverview]),
    ]);
  const handlers = {
    onSuccess: () => {
      refresh();
      notify.success(localize(agent ? 'com_admin_saved' : 'com_admin_agent_created'));
      onClose();
    },
    onError: notify.error,
  };
  const create = useCreateAgentMutation(handlers);
  const update = useUpdateAgentMutation(handlers);
  const isSaving = create.isLoading || update.isLoading;

  const entries = catalog.data?.entries.filter((entry) => entry.available) ?? [];
  const providers = [...new Set(entries.map((entry) => entry.endpoint))];
  const models = entries
    .filter((entry) => entry.endpoint === draft.provider)
    .map((entry) => ({ value: entry.model, label: entry.model }));
  const toolItems = (tools.data ?? []).map((tool) => ({ value: tool.pluginKey, label: tool.name }));
  const valid = draft.name.trim() !== '' && draft.provider !== '' && draft.model !== '';

  const submit = () => {
    const fields = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      instructions: draft.instructions.trim() || null,
      provider: draft.provider,
      model: draft.model,
      tools: draft.tools,
    };
    if (agent) {
      update.mutate({ agent_id: agent.id, data: fields });
      return;
    }
    create.mutate({
      ...fields,
      model_parameters: { model: draft.model } as AgentModelParameters,
    });
  };

  return (
    <OGDialogTemplate
      title={localize(agent ? 'com_admin_agent_edit' : 'com_admin_agent_add')}
      className="max-w-2xl"
      mainClassName="max-h-[70vh] overflow-y-auto"
      main={
        <div className="flex flex-col gap-4">
          <Field label={localize('com_admin_field_name')}>
            {(id) => (
              <Input id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} />
            )}
          </Field>
          <Field label={localize('com_admin_field_description')}>
            {(id) => (
              <Input
                id={id}
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>{localize('com_admin_field_provider')}</Label>
              <Dropdown
                variant="field"
                ariaLabel={localize('com_admin_field_provider')}
                value={draft.provider}
                onChange={(provider) =>
                  setDraft((current) => ({ ...current, provider, model: '' }))
                }
                options={providers.map((name) => ({ value: name, label: name }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{localize('com_admin_field_model')}</Label>
              <Dropdown
                variant="field"
                searchable={true}
                ariaLabel={localize('com_admin_field_model')}
                value={draft.model}
                onChange={(model) => set('model', model)}
                options={models}
                disabled={!draft.provider}
              />
            </div>
          </div>
          <Field
            label={localize('com_admin_agent_instructions')}
            hint={localize('com_admin_agent_instructions_hint')}
          >
            {(id, describedBy) => (
              <Textarea
                id={id}
                rows={6}
                aria-describedby={describedBy}
                value={draft.instructions}
                onChange={(e) => set('instructions', e.target.value)}
              />
            )}
          </Field>
          {toolItems.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>{localize('com_admin_agent_tools')}</Label>
              <MultiSelect
                items={toolItems}
                label={localize('com_admin_agent_tools')}
                labelClassName="sr-only"
                placeholder={localize('com_admin_agent_tools_placeholder')}
                selectedValues={draft.tools}
                setSelectedValues={(values) => set('tools', values)}
              />
            </div>
          )}
          <p className="text-xs text-text-secondary">{localize('com_admin_agent_builder_hint')}</p>
        </div>
      }
      selection={
        <Button onClick={submit} disabled={!valid || isSaving}>
          {isSaving ? <Spinner className="size-4" /> : localize('com_admin_save')}
        </Button>
      }
    />
  );
}

/** Creates an agent, or edits the core configuration of one (loaded with its instructions). */
export default function AgentFormDialog({
  target,
  onClose,
}: {
  target: { agent?: TAdminAgent } | null;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const agentId = target?.agent?.id ?? '';
  const expanded = useGetExpandedAgentByIdQuery(agentId, { enabled: agentId !== '' });
  const loading = agentId !== '' && expanded.isLoading;

  return (
    <OGDialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      {target != null &&
        (loading ? (
          <OGDialogTemplate
            title={localize('com_admin_loading')}
            main={<Spinner className="size-6 text-text-secondary" />}
          />
        ) : (
          <AgentForm
            key={agentId || 'new'}
            agent={agentId ? expanded.data : undefined}
            onClose={onClose}
          />
        ))}
    </OGDialog>
  );
}
