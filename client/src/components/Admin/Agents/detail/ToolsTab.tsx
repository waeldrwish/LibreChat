import { useState } from 'react';
import { Button, Switch, Spinner, MultiSelect } from '@librechat/client';
import { Tools, ArtifactModes, EModelEndpoint, AgentCapabilities } from 'librechat-data-provider';
import type { Agent } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminAgentToolsQuery, useGetEndpointsQuery } from '~/data-provider';
import { Panel, SectionTitle } from '../../common/ui';
import { useAgentSave } from './useAgentSave';
import { useLocalize } from '~/hooks';

/** Capabilities stored as entries of the agent's `tools` array. */
const TOOL_CAPABILITIES = [Tools.file_search, Tools.execute_code, Tools.web_search] as const;
type ToolCapability = (typeof TOOL_CAPABILITIES)[number];
type Capability = ToolCapability | typeof AgentCapabilities.artifacts;

const CAPABILITY_LABELS: Record<Capability, [TranslationKeys, TranslationKeys]> = {
  [Tools.file_search]: ['com_admin_agent_cap_file_search', 'com_admin_agent_cap_file_search_hint'],
  [Tools.execute_code]: [
    'com_admin_agent_cap_execute_code',
    'com_admin_agent_cap_execute_code_hint',
  ],
  [Tools.web_search]: ['com_admin_agent_cap_web_search', 'com_admin_agent_cap_web_search_hint'],
  [AgentCapabilities.artifacts]: [
    'com_admin_agent_cap_artifacts',
    'com_admin_agent_cap_artifacts_hint',
  ],
};

const CAPABILITY_SET = new Set<string>(TOOL_CAPABILITIES);

export default function ToolsTab({ agent }: { agent: Agent }) {
  const localize = useLocalize();
  const { save, isSaving } = useAgentSave(agent.id);
  const tools = useAdminAgentToolsQuery();
  const endpoints = useGetEndpointsQuery();
  const current = (agent.tools ?? []).filter((tool): tool is string => typeof tool === 'string');

  const [enabled, setEnabled] = useState<Set<Capability>>(() => {
    const initial = new Set<Capability>(
      current.filter((tool): tool is ToolCapability => CAPABILITY_SET.has(tool)),
    );
    if (agent.artifacts) {
      initial.add(AgentCapabilities.artifacts);
    }
    return initial;
  });
  const listed = new Map((tools.data ?? []).map((tool) => [tool.pluginKey, tool.name]));
  const [selected, setSelected] = useState<string[]>(() =>
    current.filter((tool) => !CAPABILITY_SET.has(tool)),
  );

  const offered = new Set(
    (endpoints.data?.[EModelEndpoint.agents]?.capabilities ?? []) as string[],
  );
  const capabilities = ([...TOOL_CAPABILITIES, AgentCapabilities.artifacts] as Capability[]).filter(
    (capability) => offered.has(capability) || enabled.has(capability),
  );
  const toolItems = [...listed].map(([value, label]) => ({ value, label }));
  /** Tools this page does not list (actions, MCP tools not loaded here) are kept as they are. */
  const untouched = current.filter((tool) => !CAPABILITY_SET.has(tool) && !listed.has(tool));

  const toggle = (capability: Capability, on: boolean) =>
    setEnabled((previous) => {
      const next = new Set(previous);
      if (on) {
        next.add(capability);
      } else {
        next.delete(capability);
      }
      return next;
    });

  const submit = () =>
    save({
      tools: [
        ...new Set([
          ...selected,
          ...untouched,
          ...TOOL_CAPABILITIES.filter((capability) => enabled.has(capability)),
        ]),
      ],
      artifacts: enabled.has(AgentCapabilities.artifacts)
        ? agent.artifacts || ArtifactModes.DEFAULT
        : '',
    });

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <SectionTitle>{localize('com_admin_agent_capabilities')}</SectionTitle>
        <ul className="divide-y divide-border-light">
          {capabilities.map((capability) => {
            const [label, hint] = CAPABILITY_LABELS[capability];
            return (
              <li key={capability} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text-primary">
                    {localize(label)}
                  </span>
                  <span className="text-xs text-text-secondary">{localize(hint)}</span>
                  {!offered.has(capability) && (
                    <span className="block text-xs text-text-secondary">
                      {localize('com_admin_agent_cap_unavailable')}
                    </span>
                  )}
                </span>
                <Switch
                  aria-label={localize(label)}
                  checked={enabled.has(capability)}
                  onCheckedChange={(on) => toggle(capability, on)}
                />
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel>
        <SectionTitle>{localize('com_admin_agent_tools')}</SectionTitle>
        <div className="flex flex-col gap-1.5">
          <MultiSelect
            portal={false}
            items={toolItems}
            label={localize('com_admin_agent_tools')}
            labelClassName="sr-only"
            placeholder={localize('com_admin_agent_tools_placeholder')}
            selectedValues={selected}
            setSelectedValues={setSelected}
          />
          {untouched.length > 0 && (
            <p className="text-xs text-text-secondary">
              {localize('com_admin_agent_tools_kept', { 0: untouched.length })}
            </p>
          )}
        </div>
      </Panel>
      <div className="flex justify-end">
        <Button onClick={submit} disabled={isSaving}>
          {isSaving ? <Spinner className="size-4" /> : localize('com_admin_save')}
        </Button>
      </div>
    </div>
  );
}
