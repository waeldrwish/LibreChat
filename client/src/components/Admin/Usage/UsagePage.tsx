import { useMemo, useState } from 'react';
import { Coins, DollarSign, MessageSquare, Users, Activity, Layers } from 'lucide-react';
import {
  Table,
  Label,
  Dropdown,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from '@librechat/client';
import type { TUsageGranularity, TUsageParams, TUsageReport } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { PickedUser } from '../common/controls';
import {
  useAdminUsageQuery,
  useAdminAgentsQuery,
  useAdminGroupsQuery,
  useAdminModelCatalogQuery,
} from '~/data-provider';
import { PageHeader, Panel, QueryState, SectionTitle, StatCard } from '../common/ui';
import { browserTimeZone, useAdminFormat } from '../common/format';
import { LocalizedDateRangePicker } from '~/components/ui';
import { UserPicker } from '../common/controls';
import { SeriesBars } from '../common/charts';
import { Cap, useAdmin } from '../context';
import { useLocalize } from '~/hooks';

const ALL = '__all__';
const MAX_RANGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

function defaultRange() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - 29 * DAY_MS);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function BreakdownTable({
  title,
  headers,
  rows,
  emptyLabel,
}: {
  title: string;
  headers: string[];
  rows: { key: string; cells: ReactNode[] }[];
  emptyLabel: string;
}) {
  return (
    <Panel>
      <SectionTitle>{title}</SectionTitle>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">{emptyLabel}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header, index) => (
                <TableHead key={header} className={index > 0 ? 'text-end' : undefined}>
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                {row.cells.map((cell, index) => (
                  <TableCell
                    key={index}
                    className={index > 0 ? 'text-end tabular-nums text-text-secondary' : undefined}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function Report({ data }: { data: TUsageReport }) {
  const localize = useLocalize();
  const format = useAdminFormat();
  const empty = localize('com_admin_no_usage_in_range');
  const series = data.series.map((point) => ({
    key: point.date,
    label: format.seriesLabel(point.date),
    value: point.tokens,
    display: format.compact(point.tokens),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={Coins}
          label={localize('com_admin_stat_tokens')}
          value={format.compact(data.totals.tokens)}
          hint={localize('com_admin_stat_tokens_split', {
            0: format.compact(data.totals.promptTokens),
            1: format.compact(data.totals.completionTokens),
          })}
        />
        <StatCard
          icon={DollarSign}
          label={localize('com_admin_stat_estimated_cost')}
          value={format.currency(data.totals.cost)}
        />
        <StatCard
          icon={MessageSquare}
          label={localize('com_admin_stat_messages')}
          value={format.number(data.totals.messages)}
        />
        <StatCard
          icon={Layers}
          label={localize('com_admin_stat_conversations')}
          value={format.number(data.totals.conversations)}
        />
        <StatCard
          icon={Users}
          label={localize('com_admin_stat_active_users')}
          value={format.number(data.totals.activeUsers)}
        />
        <StatCard
          icon={Activity}
          label={localize('com_admin_stat_requests')}
          value={format.number(data.totals.requests)}
        />
      </div>
      <Panel>
        <SectionTitle>{localize('com_admin_chart_tokens')}</SectionTitle>
        {series.length === 0 ? (
          <p className="py-10 text-center text-sm text-text-secondary">{empty}</p>
        ) : (
          <SeriesBars data={series} title={localize('com_admin_chart_tokens')} />
        )}
      </Panel>
      <BreakdownTable
        title={localize('com_admin_usage_by_model')}
        emptyLabel={empty}
        headers={[
          localize('com_admin_field_model'),
          localize('com_admin_stat_requests'),
          localize('com_admin_stat_tokens'),
          localize('com_admin_stat_estimated_cost'),
        ]}
        rows={data.byModel.map((row) => ({
          key: row.model,
          cells: [
            <span key="m" dir="ltr">
              {row.model || localize('com_admin_unknown')}
            </span>,
            format.number(row.requests),
            format.compact(row.tokens),
            format.currency(row.cost),
          ],
        }))}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <BreakdownTable
          title={localize('com_admin_usage_by_user')}
          emptyLabel={empty}
          headers={[
            localize('com_admin_field_user'),
            localize('com_admin_stat_messages'),
            localize('com_admin_stat_tokens'),
            localize('com_admin_stat_estimated_cost'),
          ]}
          rows={data.byUser.map((row) => ({
            key: row.userId,
            cells: [
              row.name || row.email || localize('com_admin_unknown'),
              format.number(row.messages),
              format.compact(row.tokens),
              format.currency(row.cost),
            ],
          }))}
        />
        <BreakdownTable
          title={localize('com_admin_usage_by_agent')}
          emptyLabel={empty}
          headers={[
            localize('com_admin_field_agent'),
            localize('com_admin_stat_conversations'),
            localize('com_admin_stat_tokens'),
            localize('com_admin_stat_estimated_cost'),
          ]}
          rows={data.byAgent.map((row) => ({
            key: row.agentId,
            cells: [
              row.name || row.agentId,
              format.number(row.conversations),
              format.compact(row.tokens),
              format.currency(row.cost),
            ],
          }))}
        />
      </div>
    </div>
  );
}

export default function UsagePage() {
  const localize = useLocalize();
  const { can, locale, isTeamScope } = useAdmin();
  const [range, setRange] = useState(defaultRange);
  const [unit, setUnit] = useState<TUsageGranularity>('day');
  const [user, setUser] = useState<PickedUser[]>([]);
  const [groupId, setGroupId] = useState(ALL);
  const [model, setModel] = useState(ALL);
  const [agentId, setAgentId] = useState(ALL);
  const timeZone = useMemo(browserTimeZone, []);
  const groups = useAdminGroupsQuery({ limit: 200 }, can(Cap.READ_GROUPS));
  const catalog = useAdminModelCatalogQuery(can(Cap.READ_MODELS));
  const agents = useAdminAgentsQuery({ limit: 200 }, can(Cap.READ_AGENTS));

  const params: TUsageParams = {
    from: range.start.toISOString(),
    to: range.end.toISOString(),
    unit,
    timeZone,
    userId: user[0]?.id,
    groupId: groupId === ALL ? undefined : groupId,
    model: model === ALL ? undefined : model,
    agentId: agentId === ALL ? undefined : agentId,
  };
  const report = useAdminUsageQuery(params);
  const modelOptions = [...new Set((catalog.data?.entries ?? []).map((entry) => entry.model))];

  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_usage')}
        description={localize(
          isTeamScope ? 'com_admin_usage_team_description' : 'com_admin_usage_description',
        )}
      />
      <Panel className="mb-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>{localize('com_admin_filter_period')}</Label>
            <LocalizedDateRangePicker
              locale={locale}
              startDate={range.start}
              endDate={range.end}
              maxRangeLength={MAX_RANGE_DAYS}
              futureDatesDisabled
              placeholder={localize('com_admin_filter_period')}
              labels={{
                apply: localize('com_admin_apply'),
                cancel: localize('com_admin_cancel'),
                startDate: localize('com_admin_filter_start'),
                endDate: localize('com_admin_filter_end'),
                invalidRange: localize('com_admin_filter_invalid_range', { 0: MAX_RANGE_DAYS }),
              }}
              onSelectDateRange={(start, end) => setRange({ start, end })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{localize('com_admin_filter_granularity')}</Label>
            <Dropdown
              variant="field"
              ariaLabel={localize('com_admin_filter_granularity')}
              value={unit}
              onChange={(value) => setUnit(value as TUsageGranularity)}
              options={[
                { value: 'day', label: localize('com_admin_granularity_day') },
                { value: 'month', label: localize('com_admin_granularity_month') },
              ]}
            />
          </div>
          {groups.data && groups.data.groups.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>{localize('com_admin_field_group')}</Label>
              <Dropdown
                variant="field"
                ariaLabel={localize('com_admin_field_group')}
                value={groupId}
                onChange={setGroupId}
                options={[
                  { value: ALL, label: localize('com_admin_filter_all_groups') },
                  ...groups.data.groups.map((group) => ({ value: group._id, label: group.name })),
                ]}
              />
            </div>
          )}
          {modelOptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>{localize('com_admin_field_model')}</Label>
              <Dropdown
                variant="field"
                searchable={true}
                ariaLabel={localize('com_admin_field_model')}
                value={model}
                onChange={setModel}
                options={[
                  { value: ALL, label: localize('com_admin_filter_all_models') },
                  ...modelOptions.map((name) => ({ value: name, label: name })),
                ]}
              />
            </div>
          )}
          {agents.data && agents.data.agents.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>{localize('com_admin_field_agent')}</Label>
              <Dropdown
                variant="field"
                searchable={true}
                ariaLabel={localize('com_admin_field_agent')}
                value={agentId}
                onChange={setAgentId}
                options={[
                  { value: ALL, label: localize('com_admin_filter_all_agents') },
                  ...agents.data.agents.map((agent) => ({ value: agent.id, label: agent.name })),
                ]}
              />
            </div>
          )}
          {can(Cap.READ_USERS) && (
            <div className="flex flex-col gap-1.5">
              <Label>{localize('com_admin_field_user')}</Label>
              <UserPicker
                label={localize('com_admin_field_user')}
                multiple={false}
                selected={user}
                onChange={setUser}
              />
            </div>
          )}
        </div>
      </Panel>
      <QueryState query={report}>{(data) => <Report data={data} />}</QueryState>
    </>
  );
}
