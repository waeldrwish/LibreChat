import { useMemo } from 'react';
import { Cpu, Bot, Coins, Users, Activity, MessageSquare, CalendarDays } from 'lucide-react';
import type { TAdminOverview } from 'librechat-data-provider';
import { PageHeader, Panel, QueryState, SectionTitle, StatCard } from '../common/ui';
import { browserTimeZone, useAdminFormat } from '../common/format';
import { RankList, SeriesBars } from '../common/charts';
import { useAdminOverviewQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { useAdmin } from '../context';

function OverviewContent({ data }: { data: TAdminOverview }) {
  const localize = useLocalize();
  const format = useAdminFormat();
  const { isTeamScope } = useAdmin();

  const series = useMemo(
    () =>
      data.series.map((point) => ({
        key: point.date,
        label: format.seriesLabel(point.date),
        value: point.tokens,
        display: format.compact(point.tokens),
      })),
    [data.series, format],
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Users}
          label={localize(isTeamScope ? 'com_admin_stat_team_users' : 'com_admin_stat_users')}
          value={format.number(data.users.total)}
          hint={
            data.users.disabled > 0
              ? localize('com_admin_stat_disabled_count', { 0: format.number(data.users.disabled) })
              : undefined
          }
        />
        <StatCard
          icon={Activity}
          label={localize('com_admin_stat_active_users')}
          value={format.number(data.users.active)}
          hint={localize('com_admin_stat_this_month')}
        />
        <StatCard
          icon={MessageSquare}
          label={localize('com_admin_stat_messages_today')}
          value={format.number(data.today.messages)}
        />
        <StatCard
          icon={Coins}
          label={localize('com_admin_stat_tokens_today')}
          value={format.compact(data.today.tokens)}
        />
        <StatCard
          icon={CalendarDays}
          label={localize('com_admin_stat_tokens_month')}
          value={format.compact(data.month.tokens)}
          hint={localize('com_admin_stat_cost', { 0: format.currency(data.month.cost) })}
        />
        {!isTeamScope && (
          <>
            <StatCard
              icon={Cpu}
              label={localize('com_admin_stat_active_models')}
              value={format.number(data.models.active)}
              hint={localize('com_admin_stat_policies', { 0: format.number(data.models.policies) })}
            />
            <StatCard
              icon={Bot}
              label={localize('com_admin_stat_agents')}
              value={format.number(data.agents.total)}
              hint={
                data.agents.disabled > 0
                  ? localize('com_admin_stat_disabled_count', {
                      0: format.number(data.agents.disabled),
                    })
                  : undefined
              }
            />
          </>
        )}
        <StatCard
          icon={MessageSquare}
          label={localize('com_admin_stat_conversations_month')}
          value={format.number(data.month.conversations)}
        />
      </div>

      <Panel className="mt-4">
        <SectionTitle>{localize('com_admin_chart_daily_tokens')}</SectionTitle>
        {series.every((point) => point.value === 0) ? (
          <p className="py-10 text-center text-sm text-text-secondary">
            {localize('com_admin_no_usage_yet')}
          </p>
        ) : (
          <SeriesBars data={series} title={localize('com_admin_chart_daily_tokens')} />
        )}
      </Panel>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle>{localize('com_admin_top_models')}</SectionTitle>
          <RankList
            emptyLabel={localize('com_admin_no_usage_yet')}
            data={data.topModels.map((row) => ({
              key: row.model,
              label: row.model || localize('com_admin_unknown'),
              value: row.tokens,
              display: format.compact(row.tokens),
            }))}
          />
        </Panel>
        <Panel>
          <SectionTitle>{localize('com_admin_top_users')}</SectionTitle>
          <RankList
            emptyLabel={localize('com_admin_no_usage_yet')}
            data={data.topUsers.map((row) => ({
              key: row.userId,
              label: row.name || row.email || localize('com_admin_unknown'),
              value: row.tokens,
              display: format.compact(row.tokens),
            }))}
          />
        </Panel>
      </div>
    </>
  );
}

export default function OverviewPage() {
  const localize = useLocalize();
  const timeZone = useMemo(browserTimeZone, []);
  const query = useAdminOverviewQuery(timeZone);
  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_overview')}
        description={localize('com_admin_overview_description')}
      />
      <QueryState query={query}>{(data) => <OverviewContent data={data} />}</QueryState>
    </>
  );
}
