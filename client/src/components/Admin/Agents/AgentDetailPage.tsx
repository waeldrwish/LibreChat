import { ArrowRight } from 'lucide-react';
import { Switch } from '@librechat/client';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Agent } from 'librechat-data-provider';
import { useGetExpandedAgentByIdQuery, useSetAdminAgentStatusMutation } from '~/data-provider';
import { PageHeader, Panel, QueryState, StatusBadge, useAdminNotify } from '../common/ui';
import { useAdminFormat } from '../common/format';
import Distribution from './detail/Distribution';
import SettingsTab from './detail/SettingsTab';
import { Cap, useAdmin } from '../context';
import PageTabs from '../common/PageTabs';
import ModelTab from './detail/ModelTab';
import ToolsTab from './detail/ToolsTab';
import FilesTab from './detail/FilesTab';
import DeleteAgent from './DeleteAgent';
import { useLocalize } from '~/hooks';

/** The stored agent also carries the operational `disabled` flag the admin panel sets. */
type AdminAgentDetail = Agent & { disabled?: boolean; createdAt?: string; updatedAt?: string };

function AccessTab({ agent }: { agent: AdminAgentDetail }) {
  const localize = useLocalize();
  const format = useAdminFormat();
  const notify = useAdminNotify();
  const queryClient = useQueryClient();
  const status = useSetAdminAgentStatusMutation();
  const enabled = agent.disabled !== true;

  const rows: [string, string][] = [
    [localize('com_admin_agent_id'), agent.id],
    [localize('com_admin_field_created'), format.dateTime(agent.createdAt)],
    [localize('com_admin_field_updated'), format.dateTime(agent.updatedAt)],
  ];

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text-primary">
              {localize('com_admin_enabled')}
            </span>
            <span className="text-xs text-text-secondary">
              {localize('com_admin_agent_status_hint')}
            </span>
          </span>
          <Switch
            aria-label={localize('com_admin_agent_enabled_label', { 0: agent.name ?? agent.id })}
            checked={enabled}
            disabled={status.isLoading}
            onCheckedChange={(checked) =>
              status.mutate(
                { id: agent.id, disabled: !checked },
                {
                  onSuccess: () => {
                    queryClient.invalidateQueries([QueryKeys.agent, agent.id, 'expanded']);
                    notify.success(
                      localize(checked ? 'com_admin_agent_enabled' : 'com_admin_agent_disabled'),
                    );
                  },
                  onError: notify.error,
                },
              )
            }
          />
        </div>
      </Panel>
      <Distribution agent={agent} />
      <Panel>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-text-secondary">{label}</dt>
              <dd className="text-text-primary" dir="auto">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}

function AgentDetail({ agent }: { agent: AdminAgentDetail }) {
  const localize = useLocalize();
  const { can } = useAdmin();
  const navigate = useNavigate();
  const canManage = can(Cap.MANAGE_AGENTS);
  const name = agent.name || agent.id;

  const tabs = [
    {
      value: 'settings',
      label: localize('com_admin_agent_tab_settings'),
      content: <SettingsTab agent={agent} />,
    },
    {
      value: 'model',
      label: localize('com_admin_agent_tab_model'),
      content: <ModelTab agent={agent} />,
    },
    {
      value: 'tools',
      label: localize('com_admin_agent_tab_tools'),
      content: <ToolsTab agent={agent} />,
    },
    {
      value: 'files',
      label: localize('com_admin_agent_tab_files'),
      content: <FilesTab agent={agent} />,
    },
    {
      value: 'access',
      label: localize('com_admin_agent_tab_access'),
      content: <AccessTab agent={agent} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={name}
        description={agent.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge
              active={agent.disabled !== true}
              label={localize(agent.disabled === true ? 'com_admin_disabled' : 'com_admin_enabled')}
            />
            {canManage && (
              <DeleteAgent
                id={agent.id}
                name={name}
                onDeleted={() => navigate('/admin/agents', { replace: true })}
              />
            )}
          </div>
        }
      />
      {canManage ? (
        <PageTabs label={localize('com_admin_agent_sections')} tabs={tabs} />
      ) : (
        <Panel>
          <p className="text-sm text-text-secondary">{localize('com_admin_agent_read_only')}</p>
        </Panel>
      )}
    </>
  );
}

export default function AgentDetailPage() {
  const localize = useLocalize();
  const { id = '' } = useParams();
  const query = useGetExpandedAgentByIdQuery(id, { enabled: id !== '', refetchOnMount: true });
  return (
    <>
      <Link
        to=".."
        relative="path"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
        {localize('com_admin_nav_agents')}
      </Link>
      <QueryState query={query}>
        {(agent) => <AgentDetail key={agent.id} agent={agent as AdminAgentDetail} />}
      </QueryState>
    </>
  );
}
