import { useState } from 'react';
import { Input, Button, Spinner, Dropdown, Textarea } from '@librechat/client';
import type { Agent } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useGetAgentCategoriesQuery } from '~/data-provider';
import { Field } from '../../common/controls';
import { useAgentSave } from './useAgentSave';
import { Panel } from '../../common/ui';
import { useLocalize } from '~/hooks';

const MAX_STARTERS = 4;
const NO_CATEGORY = '__none__';

type Draft = {
  name: string;
  description: string;
  category: string;
  instructions: string;
  starters: string[];
  contactName: string;
  contactEmail: string;
};

const toDraft = (agent: Agent): Draft => ({
  name: agent.name ?? '',
  description: agent.description ?? '',
  category: agent.category || NO_CATEGORY,
  instructions: agent.instructions ?? '',
  starters: Array.from(
    { length: MAX_STARTERS },
    (_, index) => agent.conversation_starters?.[index] ?? '',
  ),
  contactName: agent.support_contact?.name ?? '',
  contactEmail: agent.support_contact?.email ?? '',
});

export default function SettingsTab({ agent }: { agent: Agent }) {
  const localize = useLocalize();
  const categories = useGetAgentCategoriesQuery();
  const { save, isSaving } = useAgentSave(agent.id);
  const [draft, setDraft] = useState<Draft>(() => toDraft(agent));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const categoryOptions = [
    { value: NO_CATEGORY, label: localize('com_admin_agent_no_category') },
    ...(categories.data ?? [])
      .filter((category) => category.value !== 'all' && category.value !== 'promoted')
      .map((category) => ({
        value: category.value,
        label: category.label?.startsWith('com_')
          ? localize(category.label as TranslationKeys)
          : category.label || category.value,
      })),
  ];
  const emailValid = draft.contactEmail === '' || /^\S+@\S+\.\S+$/.test(draft.contactEmail);

  const submit = () =>
    save({
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      category: draft.category === NO_CATEGORY ? '' : draft.category,
      instructions: draft.instructions.trim() || null,
      conversation_starters: draft.starters.map((starter) => starter.trim()).filter(Boolean),
      support_contact: { name: draft.contactName.trim(), email: draft.contactEmail.trim() },
    });

  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={localize('com_admin_field_name')}>
            {(id) => (
              <Input id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} />
            )}
          </Field>
          <Field label={localize('com_admin_agent_category')}>
            {() => (
              <Dropdown
                portal={false}
                variant="field"
                ariaLabel={localize('com_admin_agent_category')}
                value={draft.category}
                onChange={(value) => set('category', value)}
                options={categoryOptions}
              />
            )}
          </Field>
        </div>
        <Field label={localize('com_admin_field_description')}>
          {(id) => (
            <Input
              id={id}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>
        <Field
          label={localize('com_admin_agent_instructions')}
          hint={localize('com_admin_agent_instructions_hint')}
        >
          {(id, describedBy) => (
            <Textarea
              id={id}
              rows={12}
              aria-describedby={describedBy}
              value={draft.instructions}
              onChange={(e) => set('instructions', e.target.value)}
            />
          )}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-text-primary">
            {localize('com_admin_agent_starters')}
          </legend>
          <p className="text-xs text-text-secondary">{localize('com_admin_agent_starters_hint')}</p>
          {draft.starters.map((starter, index) => (
            <Input
              key={index}
              aria-label={localize('com_admin_agent_starter_n', { 0: index + 1 })}
              value={starter}
              onChange={(e) =>
                set(
                  'starters',
                  draft.starters.map((item, at) => (at === index ? e.target.value : item)),
                )
              }
            />
          ))}
        </fieldset>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={localize('com_admin_agent_contact_name')}>
            {(id) => (
              <Input
                id={id}
                value={draft.contactName}
                onChange={(e) => set('contactName', e.target.value)}
              />
            )}
          </Field>
          <Field label={localize('com_admin_agent_contact_email')}>
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                type="email"
                aria-invalid={!emailValid}
                value={draft.contactEmail}
                onChange={(e) => set('contactEmail', e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!draft.name.trim() || !emailValid || isSaving}>
            {isSaving ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
