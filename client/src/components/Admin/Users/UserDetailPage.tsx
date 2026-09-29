import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, KeyRound, Pencil, Power } from 'lucide-react';
import { Button, Input, OGDialog, OGDialogTemplate, Spinner } from '@librechat/client';
import type { TAdminUser } from 'librechat-data-provider';
import {
  useAdminUserQuery,
  useSetAdminUserStatusMutation,
  useResetAdminUserPasswordMutation,
} from '~/data-provider';
import { PageHeader, Panel, QueryState, StatusBadge, useAdminNotify } from '../common/ui';
import { ConfirmDialog, Field } from '../common/controls';
import EffectiveAccess from '../access/EffectiveAccess';
import { useAdminFormat } from '../common/format';
import AccessEditor from '../access/AccessEditor';
import UserFormDialog from './UserFormDialog';
import { Cap, useAdmin } from '../context';
import PageTabs from '../common/PageTabs';
import { useLocalize } from '~/hooks';

const MIN_PASSWORD = 8;

function ProfileTab({ user }: { user: TAdminUser }) {
  const localize = useLocalize();
  const format = useAdminFormat();
  const rows: [string, string][] = [
    [localize('com_admin_field_name'), user.name || '—'],
    [localize('com_admin_field_username'), user.username || '—'],
    [localize('com_admin_field_email'), user.email],
    [localize('com_admin_field_role'), user.role],
    [localize('com_admin_field_groups'), format.list(user.groups.map((g) => g.name)) || '—'],
    [localize('com_admin_field_provider'), user.provider],
    [localize('com_admin_field_created'), format.dateTime(user.createdAt)],
    [localize('com_admin_field_updated'), format.dateTime(user.updatedAt)],
  ];
  if (user.disabledAt) {
    rows.push([localize('com_admin_field_disabled_at'), format.dateTime(user.disabledAt)]);
  }
  return (
    <Panel>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-text-secondary">{label}</dt>
            <dd className="mt-0.5 truncate text-sm text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function PasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: TAdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const reset = useResetAdminUserPasswordMutation();
  const [password, setPassword] = useState('');
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

  const submit = () =>
    reset.mutate(
      { id: user.id, password },
      {
        onSuccess: () => {
          notify.success(localize('com_admin_password_reset_done'));
          setPassword('');
          onOpenChange(false);
        },
        onError: notify.error,
      },
    );

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_admin_password_reset')}
        className="max-w-md"
        main={
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">
              {localize('com_admin_password_reset_description')}
            </p>
            <Field
              label={localize('com_admin_field_new_password')}
              hint={localize('com_admin_password_hint', { 0: MIN_PASSWORD })}
            >
              {(id, describedBy) => (
                <Input
                  id={id}
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  aria-describedby={describedBy}
                  aria-invalid={tooShort}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>
          </div>
        }
        selection={
          <Button onClick={submit} disabled={password.length < MIN_PASSWORD || reset.isLoading}>
            {reset.isLoading ? <Spinner className="size-4" /> : localize('com_admin_password_set')}
          </Button>
        }
      />
    </OGDialog>
  );
}

function UserDetail({ user }: { user: TAdminUser }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const { can, isTeamScope, session } = useAdmin();
  const setStatus = useSetAdminUserStatusMutation();
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const canManage = can(Cap.MANAGE_USERS);
  const canToggle = canManage || can(Cap.MANAGE_TEAM);

  const toggleStatus = () =>
    setStatus.mutate(
      { id: user.id, disabled: !user.disabled },
      {
        onSuccess: () => {
          notify.success(
            localize(user.disabled ? 'com_admin_user_enabled' : 'com_admin_user_disabled'),
          );
          setConfirmStatus(false);
        },
        onError: notify.error,
      },
    );

  return (
    <>
      <PageHeader
        title={user.name || user.email}
        description={user.email}
        actions={
          <>
            <StatusBadge
              active={!user.disabled}
              label={localize(
                user.disabled ? 'com_admin_status_disabled' : 'com_admin_status_active',
              )}
            />
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden="true" />
                {localize('com_admin_edit')}
              </Button>
            )}
            {canManage && user.provider === 'local' && (
              <Button variant="outline" size="sm" onClick={() => setResetting(true)}>
                <KeyRound className="size-4" aria-hidden="true" />
                {localize('com_admin_password_reset')}
              </Button>
            )}
            {canToggle && (
              <Button
                variant={user.disabled ? 'outline' : 'destructive'}
                size="sm"
                onClick={() => setConfirmStatus(true)}
              >
                <Power className="size-4" aria-hidden="true" />
                {localize(user.disabled ? 'com_admin_user_enable' : 'com_admin_user_disable')}
              </Button>
            )}
          </>
        }
      />
      <PageTabs
        label={localize('com_admin_user_sections')}
        tabs={[
          {
            value: 'profile',
            label: localize('com_admin_tab_profile'),
            content: <ProfileTab user={user} />,
          },
          {
            value: 'access',
            label: localize('com_admin_tab_access'),
            content: (
              <AccessEditor
                principalType="user"
                principalId={user.id}
                canManageTeamLimits={isTeamScope && session.capabilities.includes(Cap.MANAGE_TEAM)}
              />
            ),
          },
          {
            value: 'effective',
            label: localize('com_admin_tab_effective'),
            content: <EffectiveAccess userId={user.id} />,
          },
        ]}
      />
      <UserFormDialog open={editing} onOpenChange={setEditing} user={user} />
      <PasswordDialog user={user} open={resetting} onOpenChange={setResetting} />
      <ConfirmDialog
        open={confirmStatus}
        onOpenChange={setConfirmStatus}
        title={localize(user.disabled ? 'com_admin_user_enable' : 'com_admin_user_disable')}
        description={localize(
          user.disabled ? 'com_admin_user_enable_confirm' : 'com_admin_user_disable_confirm',
          { 0: user.name || user.email },
        )}
        confirmLabel={localize(user.disabled ? 'com_admin_user_enable' : 'com_admin_user_disable')}
        destructive={!user.disabled}
        isLoading={setStatus.isLoading}
        onConfirm={toggleStatus}
      />
    </>
  );
}

export default function UserDetailPage() {
  const localize = useLocalize();
  const { id } = useParams();
  const query = useAdminUserQuery(id);
  return (
    <>
      <Link
        to=".."
        relative="path"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
        {localize('com_admin_nav_users')}
      </Link>
      <QueryState query={query}>{(data) => <UserDetail user={data.user} />}</QueryState>
    </>
  );
}
