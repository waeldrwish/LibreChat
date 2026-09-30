import { useEffect, useState } from 'react';
import { SystemRoles } from 'librechat-data-provider';
import {
  Input,
  Button,
  Switch,
  Label,
  Spinner,
  OGDialog,
  Dropdown,
  MultiSelect,
  OGDialogTemplate,
} from '@librechat/client';
import type { TAdminUser } from 'librechat-data-provider';
import {
  useAdminRolesQuery,
  useAdminGroupsQuery,
  useCreateAdminUserMutation,
  useUpdateAdminUserMutation,
} from '~/data-provider';
import { useAdminNotify } from '../common/ui';
import { Field } from '../common/controls';
import { Cap, useAdmin } from '../context';
import { useLocalize } from '~/hooks';

const GROUP_PAGE = { limit: 200 };
const MIN_PASSWORD = 8;

type Draft = {
  name: string;
  email: string;
  username: string;
  password: string;
  role: string;
  groupIds: string[];
  disabled: boolean;
};

const emptyDraft: Draft = {
  name: '',
  email: '',
  username: '',
  password: '',
  role: SystemRoles.USER,
  groupIds: [],
  disabled: false,
};

/** Creates a user, or edits an existing one when `user` is given. */
export default function UserFormDialog({
  open,
  onOpenChange,
  user,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: TAdminUser;
  onSaved?: (user: TAdminUser) => void;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const { can } = useAdmin();
  const canRoles = can(Cap.MANAGE_ROLES);
  const canGroups = can(Cap.MANAGE_GROUPS);
  const roles = useAdminRolesQuery(open && can(Cap.READ_ROLES));
  const groups = useAdminGroupsQuery(GROUP_PAGE, open && can(Cap.READ_GROUPS));
  const create = useCreateAdminUserMutation();
  const update = useUpdateAdminUserMutation();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string>();
  const isEdit = user != null;
  const isSaving = create.isLoading || update.isLoading;

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(undefined);
    setDraft(
      user
        ? {
            name: user.name,
            email: user.email,
            username: user.username,
            password: '',
            role: user.role,
            groupIds: user.groups.map((group) => group.id),
            disabled: user.disabled === true,
          }
        : emptyDraft,
    );
  }, [open, user]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const roleOptions = (roles.data?.roles ?? [{ name: SystemRoles.USER }]).map((role) => ({
    value: role.name,
    label: role.name,
  }));
  const groupItems = (groups.data?.groups ?? []).map((group) => ({
    value: group._id,
    label: group.name,
  }));

  const submit = () => {
    if (!draft.name.trim() || !draft.email.trim()) {
      setError(localize('com_admin_user_required'));
      return;
    }
    if (!isEdit && draft.password.length < MIN_PASSWORD) {
      setError(localize('com_admin_password_too_short', { 0: MIN_PASSWORD }));
      return;
    }
    setError(undefined);
    const handlers = {
      onSuccess: (result: { user: TAdminUser }) => {
        notify.success(localize(isEdit ? 'com_admin_saved' : 'com_admin_user_created'));
        onOpenChange(false);
        onSaved?.(result.user);
      },
      onError: notify.error,
    };
    if (isEdit) {
      update.mutate(
        {
          id: user.id,
          body: {
            name: draft.name,
            email: draft.email,
            username: draft.username,
            ...(canRoles && draft.role !== user.role ? { role: draft.role } : {}),
            ...(canGroups ? { groupIds: draft.groupIds } : {}),
          },
        },
        handlers,
      );
      return;
    }
    create.mutate(
      {
        name: draft.name,
        email: draft.email,
        username: draft.username || undefined,
        password: draft.password,
        ...(canRoles ? { role: draft.role } : {}),
        ...(canGroups && draft.groupIds.length ? { groupIds: draft.groupIds } : {}),
        disabled: draft.disabled,
      },
      handlers,
    );
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize(isEdit ? 'com_admin_user_edit' : 'com_admin_user_add')}
        className="max-w-xl"
        main={
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={localize('com_admin_field_name')}>
                {(id) => (
                  <Input id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} />
                )}
              </Field>
              <Field label={localize('com_admin_field_username')}>
                {(id) => (
                  <Input
                    id={id}
                    dir="ltr"
                    value={draft.username}
                    onChange={(e) => set('username', e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label={localize('com_admin_field_email')}>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  dir="ltr"
                  autoComplete="off"
                  value={draft.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              )}
            </Field>
            {!isEdit && (
              <Field
                label={localize('com_admin_field_password')}
                hint={localize('com_admin_password_hint', { 0: MIN_PASSWORD })}
              >
                {(id, describedBy) => (
                  <Input
                    id={id}
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    aria-describedby={describedBy}
                    value={draft.password}
                    onChange={(e) => set('password', e.target.value)}
                  />
                )}
              </Field>
            )}
            {canRoles && (
              <div className="flex flex-col gap-1.5">
                <Label>{localize('com_admin_field_role')}</Label>
                <Dropdown
                  portal={false}
                  variant="field"
                  ariaLabel={localize('com_admin_field_role')}
                  value={draft.role}
                  options={roleOptions}
                  onChange={(value) => set('role', value)}
                />
              </div>
            )}
            {canGroups && (
              <div className="flex flex-col gap-1.5">
                <Label>{localize('com_admin_field_groups')}</Label>
                <MultiSelect
                  portal={false}
                  items={groupItems}
                  selectedValues={draft.groupIds}
                  setSelectedValues={(values) => set('groupIds', values)}
                  placeholder={localize('com_admin_field_groups_placeholder')}
                  label={localize('com_admin_field_groups')}
                  labelClassName="sr-only"
                />
              </div>
            )}
            {!isEdit && (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="admin-user-disabled">
                  {localize('com_admin_field_start_disabled')}
                </Label>
                <Switch
                  id="admin-user-disabled"
                  aria-label={localize('com_admin_field_start_disabled')}
                  checked={draft.disabled}
                  onCheckedChange={(checked) => set('disabled', checked)}
                />
              </div>
            )}
            {!isEdit && (
              <p className="text-xs text-text-secondary">
                {localize('com_admin_user_create_next')}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-text-destructive">
                {error}
              </p>
            )}
          </div>
        }
        selection={
          <Button onClick={submit} disabled={isSaving}>
            {isSaving ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
