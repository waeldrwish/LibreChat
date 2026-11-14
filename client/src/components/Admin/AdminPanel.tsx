import { useEffect, useState } from 'react';
import { Button } from '@librechat/client';
import { useNavigate } from 'react-router-dom';
import type { dataService } from 'librechat-data-provider';
import type { FormEvent } from 'react';
import {
  useAdminPanelBalance,
  useAdminPanelSummary,
  useAdminPanelUsage,
  useAdminPanelUsers,
  useCreateAdminPanelUser,
  useUpdateAdminPanelBalance,
} from '~/data-provider/AdminPanel';
import { useLocalize } from '~/hooks';

type AdminPanelUserListItem = dataService.AdminPanelUserListItem;
type AdminPanelBalance = dataService.AdminPanelBalance;
type Localize = ReturnType<typeof useLocalize>;

/** 1,000,000 token credits = $1 (1000 credits = $0.001). */
const CREDITS_PER_USD = 1_000_000;

type Tab = 'overview' | 'usage' | 'users';

function formatUsd(credits: number): string {
  return `$${(credits / CREDITS_PER_USD).toFixed(4)}`;
}

function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string; error?: string } } };
  return e?.response?.data?.message ?? e?.response?.data?.error ?? fallback;
}

function isAccessDenied(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 401 || status === 403;
}

const card = 'rounded-xl border border-border-light bg-surface-primary p-4';
const input =
  'w-full rounded-lg border border-border-medium bg-surface-primary px-3 py-2 text-sm text-text-primary';

export default function AdminPanel() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');

  /** Probes access once; the server enforces capabilities on every call regardless. */
  const summary = useAdminPanelSummary();
  useEffect(() => {
    if (summary.error && isAccessDenied(summary.error)) {
      navigate('/c/new', { replace: true });
    }
  }, [summary.error, navigate]);

  if (!summary.isSuccess) {
    return null;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: localize('com_admin_tab_overview') },
    { key: 'usage', label: localize('com_admin_tab_spend') },
    { key: 'users', label: localize('com_admin_tab_users') },
  ];

  return (
    <div dir="rtl" className="bg-surface-primary text-text-primary h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">{localize('com_admin_title')}</h1>
        <div className="border-border-light flex gap-2 border-b pb-2" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-2 text-sm ${
                tab === t.key
                  ? 'bg-surface-active text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'overview' && <Overview localize={localize} data={summary.data} />}
        {tab === 'usage' && <Usage localize={localize} />}
        {tab === 'users' && <Users localize={localize} />}
      </div>
    </div>
  );
}

function Overview({
  localize,
  data,
}: {
  localize: Localize;
  data?: dataService.AdminPanelSummary;
}) {
  if (!data) {
    return null;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <div className={card}>
        <div className="text-text-secondary text-sm">{localize('com_admin_card_users')}</div>
        <div className="text-2xl font-semibold">{data.users}</div>
      </div>
      <div className={card}>
        <div className="text-text-secondary text-sm">{localize('com_admin_card_requests')}</div>
        <div className="text-2xl font-semibold">{data.requests}</div>
      </div>
      <div className={card}>
        <div className="text-text-secondary text-sm">{localize('com_admin_card_input_tokens')}</div>
        <div className="text-2xl font-semibold">{data.inputTokens.toLocaleString()}</div>
      </div>
      <div className={card}>
        <div className="text-text-secondary text-sm">{localize('com_admin_card_spend')}</div>
        <div className="text-2xl font-semibold">{formatUsd(data.spentCredits)}</div>
      </div>
    </div>
  );
}

function Usage({ localize }: { localize: Localize }) {
  const [groupBy, setGroupBy] = useState<'user' | 'model'>('user');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const usage = useAdminPanelUsage({ groupBy, from: from || undefined, to: to || undefined });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          {localize('com_admin_group_by')}
          <select
            className={`${input} mt-1`}
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as 'user' | 'model')}
          >
            <option value="user">{localize('com_admin_group_user')}</option>
            <option value="model">{localize('com_admin_group_model')}</option>
          </select>
        </label>
        <label className="text-sm">
          {localize('com_admin_from')}
          <input
            type="date"
            className={`${input} mt-1`}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          {localize('com_admin_to')}
          <input
            type="date"
            className={`${input} mt-1`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      {usage.isError && (
        <p className="text-status-error-strong text-sm">
          {errorMessage(usage.error, localize('com_admin_usage_failed'))}
        </p>
      )}
      {usage.data && (
        <div className="border-border-light overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-text-secondary">
              <tr>
                <th className="p-2 text-start">
                  {usage.data.groupBy === 'user'
                    ? localize('com_admin_group_user')
                    : localize('com_admin_group_model')}
                </th>
                <th className="p-2 text-start">{localize('com_admin_col_requests')}</th>
                <th className="p-2 text-start">{localize('com_admin_col_input')}</th>
                <th className="p-2 text-start">{localize('com_admin_col_output')}</th>
                <th className="p-2 text-start">{localize('com_admin_col_spend')}</th>
              </tr>
            </thead>
            <tbody>
              {usage.data.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-text-secondary p-4 text-center">
                    {localize('com_admin_no_data')}
                  </td>
                </tr>
              )}
              {usage.data.rows.map((row) => (
                <tr key={row.key ?? 'unknown'} className="border-border-light border-t">
                  <td className="p-2">{row.label ?? row.key ?? localize('com_admin_unknown')}</td>
                  <td className="p-2">{row.requests}</td>
                  <td className="p-2">{row.inputTokens.toLocaleString()}</td>
                  <td className="p-2">{row.outputTokens.toLocaleString()}</td>
                  <td className="p-2">{formatUsd(row.spentCredits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Users({ localize }: { localize: Localize }) {
  const [selected, setSelected] = useState<AdminPanelUserListItem | null>(null);
  const [message, setMessage] = useState('');
  const users = useAdminPanelUsers(50);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <CreateAccount localize={localize} onCreated={setMessage} />
      <div className={card}>
        <h2 className="mb-2 font-semibold">{localize('com_admin_accounts')}</h2>
        {message && <p className="text-status-success-strong mb-2 text-sm">{message}</p>}
        <ul className="divide-border-light divide-y">
          {users.data?.users.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => setSelected(u)}
                className={`hover:bg-surface-hover w-full p-2 text-start text-sm ${
                  selected?.id === u.id ? 'bg-surface-active' : ''
                }`}
              >
                <div className="font-medium">{u.email || u.username}</div>
                <div className="text-text-secondary text-xs">
                  {u.role} · {u.provider}
                </div>
              </button>
            </li>
          ))}
          {users.data?.users.length === 0 && (
            <li className="text-text-secondary p-2 text-sm">{localize('com_admin_no_accounts')}</li>
          )}
        </ul>
      </div>
      {selected && (
        <div className="md:col-span-2">
          <BalanceEditor key={selected.id} user={selected} localize={localize} />
        </div>
      )}
    </div>
  );
}

function CreateAccount({
  localize,
  onCreated,
}: {
  localize: Localize;
  onCreated: (msg: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'USER' | 'ADMIN'>('USER');
  const create = useCreateAdminPanelUser();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { email, name: name || undefined, password, role },
      {
        onSuccess: (created) => {
          onCreated(localize('com_admin_created', { 0: created.email }));
          setEmail('');
          setName('');
          setPassword('');
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className={`${card} space-y-3`}>
      <h2 className="font-semibold">{localize('com_admin_create_account')}</h2>
      <input
        className={input}
        type="email"
        placeholder={localize('com_admin_email')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        className={input}
        placeholder={localize('com_admin_name_optional')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={input}
        type="password"
        placeholder={localize('com_admin_password_hint')}
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <select
        className={input}
        value={role}
        onChange={(e) => setRole(e.target.value as 'USER' | 'ADMIN')}
      >
        <option value="USER">{localize('com_admin_role_user')}</option>
        <option value="ADMIN">{localize('com_admin_role_admin')}</option>
      </select>
      {create.isError && (
        <p className="text-status-error-strong text-sm">
          {errorMessage(create.error, localize('com_admin_create_failed'))}
        </p>
      )}
      <Button type="submit" disabled={create.isLoading}>
        {localize('com_admin_submit_create')}
      </Button>
    </form>
  );
}

function BalanceEditor({ user, localize }: { user: AdminPanelUserListItem; localize: Localize }) {
  const balanceQuery = useAdminPanelBalance(user.id);
  const save = useUpdateAdminPanelBalance(user.id);
  const [draft, setDraft] = useState<AdminPanelBalance | null>(null);

  useEffect(() => {
    if (balanceQuery.data && !draft) {
      setDraft(balanceQuery.data);
    }
  }, [balanceQuery.data, draft]);

  if (!balanceQuery.data || !draft) {
    return <p className="text-text-secondary text-sm">{localize('com_admin_balance_loading')}</p>;
  }

  const credits = balanceQuery.data.tokenCredits;

  const submit = () => {
    save.mutate(
      {
        tokenCredits: draft.tokenCredits,
        autoRefillEnabled: draft.autoRefillEnabled,
        refillIntervalValue: draft.refillIntervalValue,
        refillIntervalUnit: draft.refillIntervalUnit,
        refillAmount: draft.refillAmount,
      },
      { onSuccess: (saved) => setDraft(saved) },
    );
  };

  return (
    <div className={`${card} space-y-3`}>
      <h2 className="font-semibold">
        {localize('com_admin_balance_title', { 0: user.email || user.username })}
      </h2>
      <p className="text-text-secondary text-sm">
        {localize('com_admin_balance_current', { 0: formatUsd(credits), 1: String(credits) })}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-sm">
          {localize('com_admin_balance_credits')}
          <input
            type="number"
            min={0}
            className={`${input} mt-1`}
            value={draft.tokenCredits}
            onChange={(e) => setDraft({ ...draft, tokenCredits: Number(e.target.value) })}
          />
        </label>
        <label className="text-sm">
          {localize('com_admin_auto_refill')}
          <select
            className={`${input} mt-1`}
            value={draft.autoRefillEnabled ? 'on' : 'off'}
            onChange={(e) => setDraft({ ...draft, autoRefillEnabled: e.target.value === 'on' })}
          >
            <option value="off">{localize('com_admin_off')}</option>
            <option value="on">{localize('com_admin_on')}</option>
          </select>
        </label>
        <label className="text-sm">
          {localize('com_admin_refill_amount')}
          <input
            type="number"
            min={0}
            className={`${input} mt-1`}
            value={draft.refillAmount}
            onChange={(e) => setDraft({ ...draft, refillAmount: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={save.isLoading}>
          {localize('com_admin_save_balance')}
        </Button>
        {save.isSuccess && <span className="text-sm">{localize('com_admin_balance_saved')}</span>}
        {save.isError && (
          <span className="text-status-error-strong text-sm">
            {errorMessage(save.error, localize('com_admin_balance_failed'))}
          </span>
        )}
      </div>
    </div>
  );
}
