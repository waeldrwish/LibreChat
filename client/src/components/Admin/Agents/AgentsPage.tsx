import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Globe, Pencil, Plus } from 'lucide-react';
import { QueryKeys, ResourceType } from 'librechat-data-provider';
import {
  Table,
  Button,
  Switch,
  Dropdown,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from '@librechat/client';
import type { TAdminAgent } from 'librechat-data-provider';
import { useAdminAgentsQuery, useSetAdminAgentStatusMutation } from '~/data-provider';
import { Empty, PageHeader, Panel, QueryState, useAdminNotify } from '../common/ui';
import { GenericGrantAccessDialog } from '~/components/Sharing';
import { Pager, SearchBox } from '../common/controls';
import { useLocalize, useDebounce } from '~/hooks';
import { useAdminFormat } from '../common/format';
import AgentFormDialog from './AgentFormDialog';
import { Cap, useAdmin } from '../context';

const PAGE_SIZE = 25;
const ALL = '__all__';

function StatusSwitch({ agent, canEdit }: { agent: TAdminAgent; canEdit: boolean }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const mutation = useSetAdminAgentStatusMutation();
  return (
    <Switch
      aria-label={localize('com_admin_agent_enabled_label', { 0: agent.name })}
      checked={!agent.disabled}
      disabled={!canEdit || mutation.isLoading}
      onCheckedChange={(checked) =>
        mutation.mutate(
          { id: agent.id, disabled: !checked },
          {
            onSuccess: () =>
              notify.success(
                localize(checked ? 'com_admin_agent_enabled' : 'com_admin_agent_disabled'),
              ),
            onError: notify.error,
          },
        )
      }
    />
  );
}

export default function AgentsPage() {
  const localize = useLocalize();
  const format = useAdminFormat();
  const { can } = useAdmin();
  const queryClient = useQueryClient();
  const canManage = can(Cap.MANAGE_AGENTS);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<{ agent?: TAdminAgent } | null>(null);
  const debounced = useDebounce(search, 300);
  const agents = useAdminAgentsQuery({
    search: debounced || undefined,
    status: status === ALL ? undefined : (status as 'enabled' | 'disabled'),
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_agents')}
        description={localize('com_admin_agents_description')}
        actions={
          canManage && (
            <Button onClick={() => setEditing({})}>
              <Plus className="size-4" aria-hidden="true" />
              {localize('com_admin_agent_add')}
            </Button>
          )
        }
      />
      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setOffset(0);
            }}
            placeholder={localize('com_admin_agents_search')}
          />
          <Dropdown
            variant="field"
            className="w-full sm:w-40"
            ariaLabel={localize('com_admin_field_status')}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setOffset(0);
            }}
            options={[
              { value: ALL, label: localize('com_admin_filter_all_statuses') },
              { value: 'enabled', label: localize('com_admin_enabled') },
              { value: 'disabled', label: localize('com_admin_disabled') },
            ]}
          />
        </div>
        <QueryState
          query={agents}
          isEmpty={(data) => data.agents.length === 0}
          empty={<Empty icon={Bot} title={localize('com_admin_agents_empty')} />}
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{localize('com_admin_field_name')}</TableHead>
                    <TableHead className="max-md:hidden">
                      {localize('com_admin_field_model')}
                    </TableHead>
                    <TableHead className="max-lg:hidden">
                      {localize('com_admin_agent_owner')}
                    </TableHead>
                    <TableHead>{localize('com_admin_agent_shared')}</TableHead>
                    <TableHead>{localize('com_admin_enabled')}</TableHead>
                    {canManage && (
                      <TableHead>
                        <span className="sr-only">{localize('com_admin_actions')}</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.agents.map((agent) => (
                    <TableRow key={agent.id}>
                      <TableCell>
                        <span className="block font-medium">{agent.name}</span>
                        {agent.description && (
                          <span className="line-clamp-1 text-xs text-text-secondary">
                            {agent.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-text-secondary max-md:hidden" dir="ltr">
                        {agent.model ?? '—'}
                      </TableCell>
                      <TableCell className="text-text-secondary max-lg:hidden">
                        {agent.authorName || '—'}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-text-secondary">
                          {agent.isPublic && (
                            <Globe
                              className="size-3.5"
                              aria-label={localize('com_admin_agent_public')}
                            />
                          )}
                          {localize('com_admin_agent_shared_count', {
                            0: format.number(agent.sharedWith),
                          })}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusSwitch agent={agent} canEdit={canManage} />
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={localize('com_admin_agent_edit_named', { 0: agent.name })}
                              onClick={() => setEditing({ agent })}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                            <GenericGrantAccessDialog
                              resourceDbId={agent._id}
                              resourceId={agent.id}
                              resourceName={agent.name}
                              resourceType={ResourceType.AGENT}
                              onGrantAccess={() =>
                                queryClient.invalidateQueries([QueryKeys.adminAgents])
                              }
                            />
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager
                total={data.total}
                limit={data.limit}
                offset={data.offset}
                onChange={setOffset}
              />
            </>
          )}
        </QueryState>
      </Panel>
      <AgentFormDialog target={editing} onClose={() => setEditing(null)} />
    </>
  );
}
