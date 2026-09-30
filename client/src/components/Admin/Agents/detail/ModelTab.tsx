import { useState } from 'react';
import { EModelEndpoint } from 'librechat-data-provider';
import { Input, Button, Spinner, Dropdown } from '@librechat/client';
import type { Agent, AgentModelParameters } from 'librechat-data-provider';
import { useAdminModelCatalogQuery } from '~/data-provider';
import { Field } from '../../common/controls';
import { useAgentSave } from './useAgentSave';
import { Panel } from '../../common/ui';
import { useLocalize } from '~/hooks';

type NumberField = 'temperature' | 'topP' | 'maxOutput' | 'maxContext' | 'steps';

/** Parameter names differ by provider family; OpenAI-compatible names cover custom providers. */
function parameterKeys(provider: string): { topP: string; maxOutput: string } {
  if (provider === EModelEndpoint.anthropic || provider === EModelEndpoint.google) {
    return { topP: 'topP', maxOutput: 'maxOutputTokens' };
  }
  if (provider === EModelEndpoint.bedrock) {
    return { topP: 'topP', maxOutput: 'maxTokens' };
  }
  return { topP: 'top_p', maxOutput: 'max_tokens' };
}

const asText = (value: unknown): string =>
  typeof value === 'number' || (typeof value === 'string' && value !== '') ? String(value) : '';

function toNumbers(agent: Agent): Record<NumberField, string> {
  const params = (agent.model_parameters ?? {}) as Record<string, unknown>;
  const keys = parameterKeys(agent.provider ?? '');
  return {
    temperature: asText(params.temperature),
    topP: asText(params[keys.topP]),
    maxOutput: asText(params[keys.maxOutput]),
    maxContext: asText(params.maxContextTokens),
    steps: asText(agent.recursion_limit),
  };
}

const LIMITS: Record<NumberField, { min: number; max?: number; step: number }> = {
  temperature: { min: 0, max: 2, step: 0.1 },
  topP: { min: 0, max: 1, step: 0.05 },
  maxOutput: { min: 1, step: 1 },
  maxContext: { min: 1, step: 1 },
  steps: { min: 1, max: 500, step: 1 },
};

const inRange = (field: NumberField, value: string): boolean => {
  if (value === '') {
    return true;
  }
  const number = Number(value);
  const { min, max } = LIMITS[field];
  return Number.isFinite(number) && number >= min && (max == null || number <= max);
};

export default function ModelTab({ agent }: { agent: Agent }) {
  const localize = useLocalize();
  const catalog = useAdminModelCatalogQuery();
  const { save, isSaving } = useAgentSave(agent.id);
  const [provider, setProvider] = useState(agent.provider ?? '');
  const [model, setModel] = useState(agent.model ?? '');
  const [numbers, setNumbers] = useState(() => toNumbers(agent));

  const entries = catalog.data?.entries.filter((entry) => entry.available) ?? [];
  const providers = [...new Set([...entries.map((entry) => entry.endpoint), agent.provider])]
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ value: name, label: name }));
  const models = entries
    .filter((entry) => entry.endpoint === provider)
    .map((entry) => ({ value: entry.model, label: entry.model }));
  const valid =
    provider !== '' &&
    model !== '' &&
    (Object.keys(numbers) as NumberField[]).every((field) => inRange(field, numbers[field]));

  const submit = () => {
    const keys = parameterKeys(provider);
    const previous = parameterKeys(agent.provider ?? '');
    const params: Record<string, unknown> = { ...(agent.model_parameters ?? {}) };
    delete params[previous.topP];
    delete params[previous.maxOutput];
    const values: [string, string][] = [
      ['temperature', numbers.temperature],
      [keys.topP, numbers.topP],
      [keys.maxOutput, numbers.maxOutput],
      ['maxContextTokens', numbers.maxContext],
    ];
    for (const [key, value] of values) {
      if (value === '') {
        delete params[key];
      } else {
        params[key] = Number(value);
      }
    }
    save({
      provider,
      model,
      model_parameters: { ...params, model } as AgentModelParameters,
      ...(numbers.steps !== '' ? { recursion_limit: Number(numbers.steps) } : {}),
    });
  };

  const numberInput = (field: NumberField, label: string, hint: string) => (
    <Field label={label} hint={hint}>
      {(id, describedBy) => (
        <Input
          id={id}
          dir="ltr"
          type="number"
          inputMode="decimal"
          min={LIMITS[field].min}
          max={LIMITS[field].max}
          step={LIMITS[field].step}
          placeholder={localize('com_admin_agent_param_default')}
          aria-describedby={describedBy}
          aria-invalid={!inRange(field, numbers[field])}
          value={numbers[field]}
          onChange={(e) => setNumbers((current) => ({ ...current, [field]: e.target.value }))}
        />
      )}
    </Field>
  );

  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={localize('com_admin_field_provider')}>
            {() => (
              <Dropdown
                portal={false}
                variant="field"
                ariaLabel={localize('com_admin_field_provider')}
                value={provider}
                onChange={(value) => {
                  setProvider(value);
                  setModel('');
                }}
                options={providers}
              />
            )}
          </Field>
          <Field label={localize('com_admin_field_model')}>
            {() => (
              <Dropdown
                portal={false}
                variant="field"
                searchable={true}
                ariaLabel={localize('com_admin_field_model')}
                value={model}
                onChange={setModel}
                options={models}
                disabled={!provider}
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {numberInput(
            'temperature',
            localize('com_admin_agent_param_temperature'),
            localize('com_admin_agent_param_temperature_hint'),
          )}
          {numberInput(
            'topP',
            localize('com_admin_agent_param_top_p'),
            localize('com_admin_agent_param_top_p_hint'),
          )}
          {numberInput(
            'maxOutput',
            localize('com_admin_agent_param_max_output'),
            localize('com_admin_agent_param_max_output_hint'),
          )}
          {numberInput(
            'maxContext',
            localize('com_admin_agent_param_max_context'),
            localize('com_admin_agent_param_max_context_hint'),
          )}
          {numberInput(
            'steps',
            localize('com_admin_agent_param_steps'),
            localize('com_admin_agent_param_steps_hint'),
          )}
        </div>
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!valid || isSaving}>
            {isSaving ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
