import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Spinner } from '@librechat/client';
import type { TPrincipalAccess } from 'librechat-data-provider';
import { useAdminAgentsQuery, useUpdateAdminAccessMutation } from '~/data-provider';
import { Panel, QueryState, SectionTitle, useAdminNotify } from '../common/ui';
import { SearchBox } from '../common/controls';
import { useLocalize } from '~/hooks';

const AGENT_PAGE = { limit: 200 };

/**
 * Which agents this principal may use. Checking an agent shares it with view access;
 * unchecking revokes a view-only share (editor or owner shares are left in place).
 */
export default function AgentAccessSection({
  access,
  principalType,
  canEdit,
}: {
  access: TPrincipalAccess;
  principalType: string;
  canEdit: boolean;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const agents = useAdminAgentsQuery(AGENT_PAGE);
  const mutation = useUpdateAdminAccessMutation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => setSelected(new Set(access.agentIds)), [access.agentIds]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (agents.data?.agents ?? []).filter(
      (agent) => !term || agent.name.toLowerCase().includes(term) || agent.id.includes(term),
    );
  }, [agents.data, search]);

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });

  const save = () =>
    mutation.mutate(
      { principalType, principalId: access.principalId, body: { agentIds: [...selected] } },
      { onSuccess: () => notify.success(localize('com_admin_saved')), onError: notify.error },
    );

  return (
    <Panel>
      <SectionTitle>{localize('com_admin_access_agents')}</SectionTitle>
      <p className="mb-3 text-sm text-text-secondary">
        {localize('com_admin_access_agents_description')}
      </p>
      <QueryState
        query={agents}
        isEmpty={(data) => data.agents.length === 0}
        empty={
          <p className="py-6 text-center text-sm text-text-secondary">
            {localize('com_admin_agents_empty')}
          </p>
        }
      >
        {() => (
          <>
            <div className="mb-3">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={localize('com_admin_agents_search')}
              />
            </div>
            <ul className="max-h-80 divide-y divide-border-light overflow-y-auto rounded-lg border border-border-light">
              {visible.map((agent) => (
                <li key={agent.id} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    id={`agent-${agent.id}`}
                    checked={selected.has(agent.id)}
                    disabled={!canEdit}
                    onCheckedChange={(checked) => toggle(agent.id, checked === true)}
                    aria-label={agent.name}
                  />
                  <label htmlFor={`agent-${agent.id}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block truncate text-sm text-text-primary">{agent.name}</span>
                    <span className="block truncate text-xs text-text-secondary" dir="ltr">
                      {agent.model ?? '—'}
                    </span>
                  </label>
                  {agent.disabled && (
                    <span className="text-xs text-text-secondary">
                      {localize('com_admin_disabled')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="mt-4 flex justify-end">
                <Button onClick={save} disabled={mutation.isLoading}>
                  {mutation.isLoading ? <Spinner className="size-4" /> : localize('com_admin_save')}
                </Button>
              </div>
            )}
          </>
        )}
      </QueryState>
    </Panel>
  );
}
