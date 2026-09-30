import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Input, Button, Spinner, Dropdown } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import type {
  Agent,
  TSetOption,
  TConversation,
  AgentModelParameters,
} from 'librechat-data-provider';
import type { Dispatch, SetStateAction } from 'react';
import {
  pruneAgentModelParameters,
  resolveAgentParameterSettings,
} from '~/components/SidePanel/Agents/parameters';
import {
  useGetEndpointsQuery,
  useGetStartupConfig,
  useAdminModelCatalogQuery,
} from '~/data-provider';
import { componentMapping } from '~/components/SidePanel/Parameters/components';
import { MarketplaceProvider } from '~/components/Agents/MarketplaceContext';
import { Panel, SectionTitle } from '../../common/ui';
import { useLocalize, useHasAccess } from '~/hooks';
import { Field } from '../../common/controls';
import { useAgentSave } from './useAgentSave';

const STEPS = { min: 1, max: 500 };

const stepsValid = (value: string): boolean => {
  if (value === '') {
    return true;
  }
  const number = Number(value);
  return Number.isInteger(number) && number >= STEPS.min && number <= STEPS.max;
};

/**
 * The provider's full parameter set, rendered with the same schema-driven controls as the
 * agent builder so both edit the same `model_parameters` the same way.
 */
function Parameters({
  provider,
  model,
  values,
  onChange,
}: {
  provider: string;
  model: string;
  values: AgentModelParameters;
  onChange: Dispatch<SetStateAction<AgentModelParameters>>;
}) {
  const localize = useLocalize();
  const { data: endpointsConfig = {} } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();
  const webSearchAllowed = useHasAccess({
    permissionType: PermissionTypes.WEB_SEARCH,
    permission: Permissions.USE,
  });
  const settings = useMemo(
    () =>
      resolveAgentParameterSettings({
        endpointsConfig,
        model,
        provider,
        startupConfig,
        webSearchAllowed,
      }),
    [endpointsConfig, model, provider, startupConfig, webSearchAllowed],
  );
  const regions = endpointsConfig?.[provider]?.availableRegions ?? [];

  const setOption: TSetOption = (key) => (value) =>
    onChange((current) => ({ ...current, [key]: value }) as AgentModelParameters);

  if (settings.visibleParameters.length === 0) {
    return <p className="text-sm text-text-secondary">{localize('com_admin_agent_params_none')}</p>;
  }

  return (
    <MarketplaceProvider>
      <div className="grid max-w-3xl grid-cols-2 gap-3 text-sm">
        {settings.visibleParameters.map((setting) => {
          const Component = componentMapping[setting.component];
          if (!Component) {
            return null;
          }
          const { key, default: defaultValue, ...rest } = setting;
          if (key === 'region' && regions.length) {
            rest.options = regions;
          }
          return (
            <Component
              key={`${provider}:${model}:${key}`}
              settingKey={key}
              defaultValue={defaultValue}
              {...rest}
              setOption={setOption}
              conversation={values as Partial<TConversation>}
            />
          );
        })}
      </div>
    </MarketplaceProvider>
  );
}

export default function ModelTab({ agent }: { agent: Agent }) {
  const localize = useLocalize();
  const catalog = useAdminModelCatalogQuery();
  const { data: endpointsConfig = {} } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();
  const { save, isSaving } = useAgentSave(agent.id);
  const [provider, setProvider] = useState(agent.provider ?? '');
  const [model, setModel] = useState(agent.model ?? '');
  const [params, setParams] = useState<AgentModelParameters>(
    () => agent.model_parameters ?? ({} as AgentModelParameters),
  );
  const [steps, setSteps] = useState(() =>
    agent.recursion_limit != null ? String(agent.recursion_limit) : '',
  );

  const entries = catalog.data?.entries.filter((entry) => entry.available) ?? [];
  const providers = [...new Set([...entries.map((entry) => entry.endpoint), agent.provider])]
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ value: name, label: name }));
  const models = entries
    .filter((entry) => entry.endpoint === provider)
    .map((entry) => ({ value: entry.model, label: entry.model }));
  const valid = provider !== '' && model !== '' && stepsValid(steps);

  const submit = () => {
    const settings = resolveAgentParameterSettings({
      endpointsConfig,
      model,
      provider,
      startupConfig,
      webSearchAllowed: true,
    });
    const pruned = pruneAgentModelParameters(params, settings);
    save({
      provider,
      model,
      model_parameters: { ...pruned, model },
      ...(steps !== '' ? { recursion_limit: Number(steps) } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel>
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
          <Field
            label={localize('com_admin_agent_param_steps')}
            hint={localize('com_admin_agent_param_steps_hint')}
          >
            {(id, describedBy) => (
              <Input
                id={id}
                dir="ltr"
                type="number"
                inputMode="numeric"
                min={STEPS.min}
                max={STEPS.max}
                step={1}
                placeholder={localize('com_admin_agent_param_default')}
                aria-describedby={describedBy}
                aria-invalid={!stepsValid(steps)}
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Panel>
      <Panel>
        <SectionTitle
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setParams({} as AgentModelParameters)}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              {localize('com_admin_agent_params_reset')}
            </Button>
          }
        >
          {localize('com_admin_agent_params')}
        </SectionTitle>
        <p className="mb-4 text-xs text-text-secondary">
          {localize('com_admin_agent_params_hint')}
        </p>
        {provider && model ? (
          <Parameters provider={provider} model={model} values={params} onChange={setParams} />
        ) : (
          <p className="text-sm text-text-secondary">
            {localize('com_admin_agent_params_pick_model')}
          </p>
        )}
      </Panel>
      <div className="flex justify-end">
        <Button onClick={submit} disabled={!valid || isSaving}>
          {isSaving ? <Spinner className="size-4" /> : localize('com_admin_save')}
        </Button>
      </div>
    </div>
  );
}
