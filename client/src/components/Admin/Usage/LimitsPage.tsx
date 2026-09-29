import { Link } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { UNLIMITED_USAGE, USAGE_LIMIT_METRICS } from 'librechat-data-provider';
import {
  Table,
  Button,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from '@librechat/client';
import type { AccessPrincipalType, TUsageLimits } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { Empty, PageHeader, Panel, QueryState, SectionTitle, StatusBadge } from '../common/ui';
import { useAdminLimitsQuery, useAdminSettingsQuery } from '~/data-provider';
import { METRIC_LABELS } from '../access/LimitsSection';
import { useAdminFormat } from '../common/format';
import { Cap, useAdmin } from '../context';
import { useLocalize } from '~/hooks';

const PRINCIPAL_LABELS: Record<AccessPrincipalType, TranslationKeys> = {
  user: 'com_admin_source_user',
  group: 'com_admin_source_group',
  role: 'com_admin_source_role',
};

const PRINCIPAL_PATHS: Record<AccessPrincipalType, string> = {
  user: 'users',
  group: 'groups',
  role: 'roles',
};

function useLimitText() {
  const localize = useLocalize();
  const format = useAdminFormat();
  return (limits: TUsageLimits, metric: (typeof USAGE_LIMIT_METRICS)[number]) => {
    const value = limits[metric];
    if (value == null) {
      return localize('com_admin_limit_inherit');
    }
    return value === UNLIMITED_USAGE ? localize('com_admin_limit_unlimited') : format.number(value);
  };
}

function Defaults() {
  const localize = useLocalize();
  const settings = useAdminSettingsQuery();
  const text = useLimitText();
  return (
    <Panel className="mb-4">
      <SectionTitle
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="../settings" relative="path">
              {localize('com_admin_nav_settings')}
            </Link>
          </Button>
        }
      >
        {localize('com_admin_limits_defaults')}
      </SectionTitle>
      <QueryState query={settings}>
        {(data) => (
          <>
            <div className="mb-3">
              <StatusBadge
                active={data.governance.limits.enabled}
                label={localize(
                  data.governance.limits.enabled
                    ? 'com_admin_limits_enforced'
                    : 'com_admin_limits_not_enforced',
                )}
              />
            </div>
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {USAGE_LIMIT_METRICS.map((metric) => (
                <div key={metric}>
                  <dt className="text-xs text-text-secondary">{localize(METRIC_LABELS[metric])}</dt>
                  <dd className="mt-0.5 text-sm">
                    {data.governance.limits.defaults[metric] == null
                      ? localize('com_admin_limit_unlimited')
                      : text(data.governance.limits.defaults, metric)}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </QueryState>
    </Panel>
  );
}

export default function LimitsPage() {
  const localize = useLocalize();
  const format = useAdminFormat();
  const { can } = useAdmin();
  const limits = useAdminLimitsQuery();
  const text = useLimitText();

  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_limits')}
        description={localize('com_admin_limits_description')}
      />
      {can(Cap.READ_CONFIGS) && <Defaults />}
      <Panel>
        <SectionTitle>{localize('com_admin_limits_explicit')}</SectionTitle>
        <p className="mb-3 text-sm text-text-secondary">
          {localize('com_admin_limits_precedence')}
        </p>
        <QueryState
          query={limits}
          isEmpty={(data) => data.limits.length === 0}
          empty={
            <Empty
              icon={SlidersHorizontal}
              title={localize('com_admin_limits_empty')}
              description={localize('com_admin_limits_empty_description')}
            />
          }
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{localize('com_admin_limits_applies_to')}</TableHead>
                  {USAGE_LIMIT_METRICS.map((metric) => (
                    <TableHead key={metric} className="max-md:hidden">
                      {localize(METRIC_LABELS[metric])}
                    </TableHead>
                  ))}
                  <TableHead className="max-lg:hidden">
                    {localize('com_admin_field_updated')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.limits.map((entry) => (
                  <TableRow key={`${entry.principalType}:${entry.principalId}`}>
                    <TableCell>
                      <Link
                        to={`../${PRINCIPAL_PATHS[entry.principalType]}/${encodeURIComponent(entry.principalId)}?tab=access`}
                        relative="path"
                        className="font-medium text-text-primary hover:underline"
                      >
                        {entry.principalName || entry.principalId}
                      </Link>
                      <span className="block text-xs text-text-secondary">
                        {localize(PRINCIPAL_LABELS[entry.principalType])}
                      </span>
                    </TableCell>
                    {USAGE_LIMIT_METRICS.map((metric) => (
                      <TableCell
                        key={metric}
                        className="tabular-nums text-text-secondary max-md:hidden"
                      >
                        {text(entry.limits, metric)}
                      </TableCell>
                    ))}
                    <TableCell className="text-text-secondary max-lg:hidden">
                      {format.date(entry.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryState>
      </Panel>
    </>
  );
}
