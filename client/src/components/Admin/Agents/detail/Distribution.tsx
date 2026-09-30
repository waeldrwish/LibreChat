import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, ShieldCheck, User, Users, X } from 'lucide-react';
import { Input, Button, Switch, Spinner, Dropdown } from '@librechat/client';
import { QueryKeys, ResourceType, AccessRoleIds, PrincipalType } from 'librechat-data-provider';
import {
  useSearchPrincipalsQuery,
  useGetResourcePermissionsQuery,
  useUpdateResourcePermissionsMutation,
} from 'librechat-data-provider/react-query';
import type {
  Agent,
  TPrincipal,
  TPrincipalSearchResult,
  TUpdateResourcePermissionsRequest,
} from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { Panel, QueryState, SectionTitle, useAdminNotify } from '../../common/ui';
import { useLocalize, useDebounce } from '~/hooks';

const LEVELS: [AccessRoleIds, TranslationKeys][] = [
  [AccessRoleIds.AGENT_VIEWER, 'com_admin_agent_level_viewer'],
  [AccessRoleIds.AGENT_EDITOR, 'com_admin_agent_level_editor'],
  [AccessRoleIds.AGENT_OWNER, 'com_admin_agent_level_owner'],
];

const PRINCIPAL_KINDS: Partial<Record<PrincipalType, [LucideIcon, TranslationKeys]>> = {
  [PrincipalType.USER]: [User, 'com_admin_principal_user'],
  [PrincipalType.GROUP]: [Users, 'com_admin_principal_group'],
  [PrincipalType.ROLE]: [ShieldCheck, 'com_admin_principal_role'],
};

const principalKey = (principal: {
  type: PrincipalType;
  id?: string | null;
  idOnTheSource?: string;
}) => `${principal.type}:${principal.id ?? principal.idOnTheSource ?? ''}`;

const toPrincipal = (result: TPrincipalSearchResult, accessRoleId: AccessRoleIds): TPrincipal => ({
  type: result.type,
  id: result.id ?? undefined,
  name: result.name,
  email: result.email,
  source: result.source,
  idOnTheSource: result.idOnTheSource,
  accessRoleId,
});

function PrincipalLabel({ principal }: { principal: Pick<TPrincipal, 'type' | 'name' | 'email'> }) {
  const localize = useLocalize();
  const [Icon, kind] = PRINCIPAL_KINDS[principal.type] ?? [User, 'com_admin_principal_user'];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-text-primary">
          {principal.name || principal.email}
        </span>
        <span className="block truncate text-xs text-text-secondary">
          {localize(kind)}
          {principal.email && principal.type !== PrincipalType.ROLE && (
            <>
              {' · '}
              <span dir="ltr">{principal.email}</span>
            </>
          )}
        </span>
      </span>
    </span>
  );
}

/** Finds users, groups and roles to hand the agent to. */
function Assign({
  taken,
  onAssign,
  disabled,
}: {
  taken: Set<string>;
  onAssign: (principal: TPrincipal) => void;
  disabled: boolean;
}) {
  const localize = useLocalize();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<string>(AccessRoleIds.AGENT_VIEWER);
  const debounced = useDebounce(query, 300);
  const search = useSearchPrincipalsQuery({ q: debounced.trim(), limit: 10 });
  const results = (search.data?.results ?? []).filter(
    (result) => PRINCIPAL_KINDS[result.type] && !taken.has(principalKey(result)),
  );
  const levelOptions = LEVELS.map(([value, label]) => ({ value, label: localize(label) }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={localize('com_admin_agent_distribution_search')}
            aria-label={localize('com_admin_agent_distribution_add')}
            aria-controls={listId}
          />
          {search.isFetching && (
            <Spinner className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
          )}
        </div>
        <Dropdown
          portal={false}
          variant="field"
          className="w-full sm:w-44"
          ariaLabel={localize('com_admin_agent_distribution_level')}
          value={level}
          onChange={setLevel}
          options={levelOptions}
        />
      </div>
      {debounced.trim().length >= 2 && (
        <ul
          id={listId}
          className="max-h-60 overflow-y-auto rounded-lg border border-border-light"
          aria-label={localize('com_admin_search_results')}
        >
          {results.length === 0 && !search.isFetching && (
            <li className="px-3 py-2 text-sm text-text-secondary">
              {localize('com_admin_no_results')}
            </li>
          )}
          {results.map((result) => (
            <li key={principalKey(result)}>
              <button
                type="button"
                disabled={disabled}
                className="flex w-full items-center px-3 py-2 text-start hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none disabled:opacity-50"
                onClick={() => {
                  onAssign(toPrincipal(result, level as AccessRoleIds));
                  setQuery('');
                }}
              >
                <PrincipalLabel principal={result} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Who the agent is handed out to, edited in place: each change is one call to the
 * sharing API, which the admin's agent-management capability authorizes.
 */
export default function Distribution({ agent }: { agent: Agent }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const queryClient = useQueryClient();
  const agentDbId = agent._id ?? '';
  const permissions = useGetResourcePermissionsQuery(ResourceType.AGENT, agentDbId, {
    refetchOnMount: true,
  });
  const mutation = useUpdateResourcePermissionsMutation();

  const update = (data: Partial<TUpdateResourcePermissionsRequest>) =>
    mutation.mutate(
      {
        resourceType: ResourceType.AGENT,
        resourceId: agentDbId,
        data: { updated: [], removed: [], ...data },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries([QueryKeys.adminAgents]);
          notify.success(localize('com_admin_agent_distribution_saved'));
        },
        onError: notify.error,
      },
    );

  const levelOptions = LEVELS.map(([value, label]) => ({ value, label: localize(label) }));

  return (
    <Panel>
      <SectionTitle>{localize('com_admin_agent_distribution')}</SectionTitle>
      <p className="mb-4 text-xs text-text-secondary">
        {localize('com_admin_agent_distribution_hint')}
      </p>
      <QueryState query={permissions}>
        {(data) => {
          const principals = data.principals.filter((principal) => PRINCIPAL_KINDS[principal.type]);
          const taken = new Set(principals.map(principalKey));
          return (
            <div className="flex flex-col gap-4">
              <Assign
                taken={taken}
                disabled={mutation.isLoading}
                onAssign={(principal) => update({ updated: [principal] })}
              />
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light px-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Globe className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm text-text-primary">
                      {localize('com_admin_agent_distribution_everyone')}
                    </span>
                    <span className="block text-xs text-text-secondary">
                      {localize('com_admin_agent_distribution_everyone_hint')}
                    </span>
                  </span>
                </span>
                <Switch
                  aria-label={localize('com_admin_agent_distribution_everyone')}
                  checked={data.public}
                  disabled={mutation.isLoading}
                  onCheckedChange={(on) =>
                    update(
                      on
                        ? { public: true, publicAccessRoleId: AccessRoleIds.AGENT_VIEWER }
                        : { public: false },
                    )
                  }
                />
              </div>
              {principals.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  {localize('com_admin_agent_distribution_empty')}
                </p>
              ) : (
                <ul
                  className="divide-y divide-border-light"
                  aria-label={localize('com_admin_agent_distribution')}
                >
                  {principals.map((principal) => {
                    const name = principal.name || principal.email || principal.id || '';
                    const isCreator =
                      principal.type === PrincipalType.USER && principal.id === agent.author;
                    return (
                      <li
                        key={principalKey(principal)}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <PrincipalLabel principal={principal} />
                        <span className="flex items-center gap-1">
                          {isCreator ? (
                            <span className="rounded-full border border-border-light px-2 py-0.5 text-xs text-text-secondary">
                              {localize('com_admin_agent_creator')}
                            </span>
                          ) : (
                            <>
                              <Dropdown
                                portal={false}
                                variant="field"
                                className="w-40"
                                ariaLabel={localize('com_admin_agent_distribution_level_for', {
                                  0: name,
                                })}
                                value={principal.accessRoleId ?? AccessRoleIds.AGENT_VIEWER}
                                onChange={(value) =>
                                  update({
                                    updated: [
                                      { ...principal, accessRoleId: value as AccessRoleIds },
                                    ],
                                  })
                                }
                                options={levelOptions}
                              />
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={mutation.isLoading}
                                aria-label={localize('com_admin_agent_distribution_remove', {
                                  0: name,
                                })}
                                onClick={() => update({ removed: [principal] })}
                              >
                                <X className="size-4" aria-hidden="true" />
                              </Button>
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        }}
      </QueryState>
    </Panel>
  );
}
