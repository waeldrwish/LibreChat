import { useState } from 'react';
import { Button, Dropdown, Input, Spinner } from '@librechat/client';
import { X, ChevronDown, Download, ScrollText, ShieldCheck } from 'lucide-react';
import { AUDIT_CATEGORIES, AUDIT_OUTCOMES, dataService } from 'librechat-data-provider';
import type {
  AuditOutcome,
  AuditCategory,
  AdminAuditLogEntry,
  TAdminAuditLogParams,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { Empty, PageHeader, Panel, QueryState, useAdminNotify } from '../common/ui';
import { LocalizedDateRangePicker } from '~/components/ui';
import { useAdminAuditLogQuery } from '~/data-provider';
import { useLocalize, useDebounce } from '~/hooks';
import { useAdminFormat } from '../common/format';
import { SearchBox } from '../common/controls';
import { useAdmin } from '../context';
import { cn } from '~/utils';

const ALL = '__all__';
const PAGE_SIZE = 50;

const actionKey = (action: string) =>
  `com_admin_audit_action_${action.replace(/\./g, '_')}` as TranslationKeys;
const categoryKey = (category: string) => `com_admin_audit_category_${category}` as TranslationKeys;
const outcomeKey = (outcome: string) => `com_admin_audit_outcome_${outcome}` as TranslationKeys;

function EntryRow({ entry }: { entry: AdminAuditLogEntry }) {
  const localize = useLocalize();
  const format = useAdminFormat();
  const [open, setOpen] = useState(false);
  const metadata = Object.entries(entry.metadata ?? {});
  const detailsId = `audit-${entry.id}`;

  return (
    <li className="py-3">
      <button
        type="button"
        className="flex w-full flex-wrap items-start justify-between gap-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-text-primary">
            <strong className="font-medium">{entry.actor.name}</strong>{' '}
            {localize(actionKey(entry.action))}{' '}
            {entry.target.name && <span className="font-medium">{entry.target.name}</span>}
          </span>
          <span className="mt-0.5 block text-xs text-text-secondary">
            {format.dateTime(entry.timestamp)} · {localize(categoryKey(entry.category))}
            {entry.context?.ip && (
              <>
                {' · '}
                <span dir="ltr">{entry.context.ip}</span>
              </>
            )}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs',
              entry.outcome === 'success'
                ? 'bg-status-success-subtle text-text-primary'
                : 'bg-status-warning-subtle text-text-primary',
            )}
          >
            {localize(outcomeKey(entry.outcome))}
          </span>
          <ChevronDown
            className={cn(
              'size-4 text-text-secondary transition-transform motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </span>
      </button>
      {open && (
        <dl
          id={detailsId}
          className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg bg-surface-tertiary p-3 text-xs sm:grid-cols-2"
        >
          <div>
            <dt className="text-text-secondary">{localize('com_admin_audit_target')}</dt>
            <dd dir="ltr" className="break-all">
              {entry.target.type}
              {entry.target.id ? ` · ${entry.target.id}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">{localize('com_admin_audit_severity')}</dt>
            <dd>{entry.severity}</dd>
          </div>
          {metadata.map(([key, value]) => (
            <div key={key}>
              <dt className="text-text-secondary" dir="ltr">
                {key}
              </dt>
              <dd dir="ltr" className="break-all">
                {String(value)}
              </dd>
            </div>
          ))}
          {entry.context?.userAgent && (
            <div className="sm:col-span-2">
              <dt className="text-text-secondary">{localize('com_admin_audit_user_agent')}</dt>
              <dd dir="ltr" className="break-all">
                {entry.context.userAgent}
              </dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt className="text-text-secondary">{localize('com_admin_audit_integrity')}</dt>
            <dd dir="ltr" className="break-all font-mono">
              #{entry.integrity.seq} · {entry.integrity.hash.slice(0, 16)}…
            </dd>
          </div>
        </dl>
      )}
    </li>
  );
}

export default function AuditLogPage() {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const { locale } = useAdmin();
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [category, setCategory] = useState(ALL);
  const [outcome, setOutcome] = useState(ALL);
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null);
  const [cursors, setCursors] = useState<number[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const debouncedActor = useDebounce(actor, 300);

  const filters: TAdminAuditLogParams = {
    search: debouncedSearch || undefined,
    actorQuery: debouncedActor || undefined,
    category: category === ALL ? undefined : (category as AuditCategory),
    outcome: outcome === ALL ? undefined : (outcome as AuditOutcome),
    from: range?.start.toISOString(),
    to: range?.end.toISOString(),
  };
  const cursor = cursors[cursors.length - 1];
  const log = useAdminAuditLogQuery({ ...filters, limit: PAGE_SIZE, cursor });
  const resetPaging =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setCursors([]);
    };

  const verify = async () => {
    setVerifying(true);
    try {
      const result = await dataService.verifyAdminAuditLog();
      if (result.ok) {
        notify.success(localize('com_admin_audit_verify_ok', { 0: result.checked }));
      } else {
        notify.failure(localize('com_admin_audit_verify_failed'));
      }
    } catch (error) {
      notify.error(error);
    } finally {
      setVerifying(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const url = URL.createObjectURL(await dataService.exportAdminAuditLog(filters));
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify.error(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_audit')}
        description={localize('com_admin_audit_description')}
        actions={
          <>
            <Button variant="outline" onClick={verify} disabled={verifying}>
              {verifying ? (
                <Spinner className="size-4" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              {localize('com_admin_audit_verify')}
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={exporting}>
              {exporting ? (
                <Spinner className="size-4" />
              ) : (
                <Download className="size-4" aria-hidden="true" />
              )}
              {localize('com_admin_audit_export')}
            </Button>
          </>
        }
      />
      <Panel>
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <SearchBox
            value={search}
            onChange={resetPaging(setSearch)}
            placeholder={localize('com_admin_audit_search')}
          />
          <Input
            value={actor}
            onChange={(event) => resetPaging(setActor)(event.target.value)}
            placeholder={localize('com_admin_audit_actor')}
            aria-label={localize('com_admin_audit_actor')}
          />
          <Dropdown
            variant="field"
            ariaLabel={localize('com_admin_audit_category')}
            value={category}
            onChange={resetPaging(setCategory)}
            options={[
              { value: ALL, label: localize('com_admin_filter_all_categories') },
              ...AUDIT_CATEGORIES.map((item) => ({
                value: item,
                label: localize(categoryKey(item)),
              })),
            ]}
          />
          <Dropdown
            variant="field"
            ariaLabel={localize('com_admin_audit_outcome')}
            value={outcome}
            onChange={resetPaging(setOutcome)}
            options={[
              { value: ALL, label: localize('com_admin_filter_all_outcomes') },
              ...AUDIT_OUTCOMES.map((item) => ({ value: item, label: localize(outcomeKey(item)) })),
            ]}
          />
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <LocalizedDateRangePicker
                locale={locale}
                startDate={range?.start}
                endDate={range?.end}
                futureDatesDisabled
                placeholder={localize('com_admin_audit_any_date')}
                labels={{
                  apply: localize('com_admin_apply'),
                  cancel: localize('com_admin_cancel'),
                  startDate: localize('com_admin_filter_start'),
                  endDate: localize('com_admin_filter_end'),
                  invalidRange: localize('com_admin_filter_end_before_start'),
                }}
                onSelectDateRange={(start, end) => resetPaging(setRange)({ start, end })}
              />
            </div>
            {range && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={localize('com_ui_clear')}
                onClick={() => resetPaging(setRange)(null)}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
        <QueryState
          query={log}
          isEmpty={(data) => data.entries.length === 0}
          empty={<Empty icon={ScrollText} title={localize('com_admin_audit_empty')} />}
        >
          {(data) => (
            <>
              <p className="mb-2 text-xs text-text-secondary">
                {localize('com_admin_audit_total', { 0: data.total })}
              </p>
              <ul className="divide-y divide-border-light">
                {data.entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
              </ul>
              <div className="mt-4 flex justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cursors.length === 0}
                  onClick={() => setCursors((current) => current.slice(0, -1))}
                >
                  {localize('com_admin_newer')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.nextCursor == null}
                  onClick={() =>
                    data.nextCursor != null &&
                    setCursors((current) => [...current, data.nextCursor as number])
                  }
                >
                  {localize('com_admin_older')}
                </Button>
              </div>
            </>
          )}
        </QueryState>
      </Panel>
    </>
  );
}
