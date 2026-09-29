import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, Settings2 } from 'lucide-react';
import { ANY_MODEL } from 'librechat-data-provider';
import {
  Table,
  Button,
  Dropdown,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from '@librechat/client';
import type { ModelPolicyAccess, TModelCatalog, TModelPolicy } from 'librechat-data-provider';
import type { PolicyTarget } from './PolicyDialog';
import type { TranslationKeys } from '~/hooks';
import { Empty, PageHeader, Panel, QueryState, SectionTitle, StatusBadge } from '../common/ui';
import { useAdminModelCatalogQuery } from '~/data-provider';
import { useAdminFormat } from '../common/format';
import { SearchBox } from '../common/controls';
import { Cap, useAdmin } from '../context';
import PolicyDialog from './PolicyDialog';
import { useLocalize } from '~/hooks';

const ALL = '__all__';

const ACCESS_LABELS: Record<ModelPolicyAccess, TranslationKeys> = {
  inherit: 'com_admin_policy_access_inherit_short',
  all: 'com_admin_policy_access_all_short',
  restricted: 'com_admin_policy_access_restricted_short',
};

function grantSummary(policy: TModelPolicy | undefined, localize: ReturnType<typeof useLocalize>) {
  if (!policy || policy.grants.length === 0) {
    return '—';
  }
  const allow = policy.grants.filter((grant) => grant.effect === 'allow').length;
  const deny = policy.grants.length - allow;
  return localize('com_admin_grants_summary', { 0: allow, 1: deny });
}

function Catalog({
  catalog,
  onEdit,
}: {
  catalog: TModelCatalog;
  onEdit: (target: PolicyTarget) => void;
}) {
  const localize = useLocalize();
  const format = useAdminFormat();
  const { can } = useAdmin();
  const canEdit = can(Cap.MANAGE_MODELS);
  const [search, setSearch] = useState('');
  const [endpoint, setEndpoint] = useState(ALL);

  const entries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalog.entries.filter(
      (entry) =>
        (endpoint === ALL || entry.endpoint === endpoint) &&
        (!term || entry.model.toLowerCase().includes(term)),
    );
  }, [catalog.entries, endpoint, search]);

  const endpointPolicies = new Map(
    catalog.endpointPolicies.map((policy) => [policy.endpoint, policy]),
  );

  return (
    <>
      <Panel className="mb-4">
        <SectionTitle>{localize('com_admin_models_providers_wide')}</SectionTitle>
        <p className="mb-3 text-sm text-text-secondary">
          {localize('com_admin_models_providers_wide_description')}
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.endpoints.map((name) => {
            const policy = endpointPolicies.get(name);
            return (
              <li
                key={name}
                className="flex items-center justify-between gap-2 rounded-lg border border-border-light px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium" dir="ltr">
                    {name}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {policy
                      ? `${localize(policy.enabled ? 'com_admin_enabled' : 'com_admin_disabled')} · ${localize(ACCESS_LABELS[policy.access])}`
                      : localize('com_admin_policy_none')}
                  </span>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={localize('com_admin_policy_title_endpoint', { 0: name })}
                    onClick={() => onEdit({ endpoint: name, model: ANY_MODEL, policy })}
                  >
                    <Settings2 className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={localize('com_admin_models_search')}
          />
          <Dropdown
            variant="field"
            className="w-full sm:w-48"
            ariaLabel={localize('com_admin_field_provider')}
            value={endpoint}
            onChange={setEndpoint}
            options={[
              { value: ALL, label: localize('com_admin_filter_all_providers') },
              ...catalog.endpoints.map((name) => ({ value: name, label: name })),
            ]}
          />
          <span className="text-sm text-text-secondary">
            {localize('com_admin_models_count', { 0: format.number(entries.length) })}
          </span>
        </div>
        {entries.length === 0 ? (
          <Empty icon={Cpu} title={localize('com_admin_models_empty')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{localize('com_admin_field_model')}</TableHead>
                <TableHead>{localize('com_admin_field_provider')}</TableHead>
                <TableHead>{localize('com_admin_field_status')}</TableHead>
                <TableHead className="max-md:hidden">
                  {localize('com_admin_policy_access')}
                </TableHead>
                <TableHead className="max-lg:hidden">
                  {localize('com_admin_policy_grants')}
                </TableHead>
                <TableHead className="max-lg:hidden">
                  {localize('com_admin_policy_max_tokens')}
                </TableHead>
                {canEdit && (
                  <TableHead>
                    <span className="sr-only">{localize('com_admin_actions')}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={`${entry.endpoint}|${entry.model}`}>
                  <TableCell>
                    <span className="block font-medium" dir="ltr">
                      {entry.policy?.label || entry.model}
                    </span>
                    {entry.policy?.label && (
                      <span className="block text-xs text-text-secondary" dir="ltr">
                        {entry.model}
                      </span>
                    )}
                    {!entry.available && (
                      <span className="block text-xs text-text-warning">
                        {localize('com_admin_model_unavailable')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-text-secondary" dir="ltr">
                    {entry.endpoint}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      active={entry.policy?.enabled !== false}
                      label={localize(
                        entry.policy?.enabled === false
                          ? 'com_admin_disabled'
                          : 'com_admin_enabled',
                      )}
                    />
                  </TableCell>
                  <TableCell className="text-text-secondary max-md:hidden">
                    {localize(ACCESS_LABELS[entry.policy?.access ?? 'inherit'])}
                  </TableCell>
                  <TableCell className="text-text-secondary max-lg:hidden">
                    {grantSummary(entry.policy, localize)}
                  </TableCell>
                  <TableCell className="tabular-nums text-text-secondary max-lg:hidden">
                    {entry.policy?.maxOutputTokens
                      ? format.number(entry.policy.maxOutputTokens)
                      : '—'}
                  </TableCell>
                  {canEdit && (
                    <TableCell className="text-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onEdit({
                            endpoint: entry.endpoint,
                            model: entry.model,
                            policy: entry.policy,
                          })
                        }
                      >
                        {localize('com_admin_policy_manage')}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </>
  );
}

export default function ModelsPage() {
  const localize = useLocalize();
  const { can } = useAdmin();
  const catalog = useAdminModelCatalogQuery();
  const [target, setTarget] = useState<PolicyTarget | null>(null);

  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_models')}
        description={localize('com_admin_models_description')}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="../providers" relative="path">
                {localize('com_admin_nav_providers')}
              </Link>
            </Button>
            {can(Cap.READ_CONFIGS) && (
              <Button asChild variant="outline">
                <Link to="../settings" relative="path">
                  {localize('com_admin_models_default_policy')}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <QueryState query={catalog}>
        {(data) => (
          <>
            <p className="mb-4 text-sm text-text-secondary">
              {localize(
                data.defaultPolicy === 'allow'
                  ? 'com_admin_models_default_allow'
                  : 'com_admin_models_default_deny',
              )}
            </p>
            <Catalog catalog={data} onEdit={setTarget} />
          </>
        )}
      </QueryState>
      <PolicyDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
