import { useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { SystemRoles, isSystemRoleName } from 'librechat-data-provider';
import {
  Input,
  Label,
  Button,
  Spinner,
  OGDialog,
  Dropdown,
  Textarea,
  OGDialogTemplate,
} from '@librechat/client';
import type { TranslationKeys } from '~/hooks';
import {
  useAdminRolesQuery,
  useCreateAdminRoleMutation,
  useToggleAdminRoleGrantMutation,
} from '~/data-provider';
import { Empty, PageHeader, Panel, QueryState, useAdminNotify } from '../common/ui';
import { ROLE_PRESETS } from './capabilities';
import { Field } from '../common/controls';
import { Cap, useAdmin } from '../context';
import { useLocalize } from '~/hooks';

const ROLE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const SYSTEM_ROLE_DESCRIPTIONS: Record<string, TranslationKeys | undefined> = {
  [SystemRoles.ADMIN]: 'com_admin_role_admin_description',
  [SystemRoles.USER]: 'com_admin_role_user_description',
};

function CreateRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const navigate = useNavigate();
  const { can } = useAdmin();
  const create = useCreateAdminRoleMutation();
  const grant = useToggleAdminRoleGrantMutation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [preset, setPreset] = useState('none');
  const isValid = ROLE_NAME.test(name.trim());
  const isSaving = create.isLoading || grant.isLoading;

  const submit = async () => {
    const roleName = name.trim().toUpperCase();
    try {
      await create.mutateAsync({ name: roleName, description: description.trim() });
      const capabilities = (
        ROLE_PRESETS.find((item) => item.value === preset)?.capabilities ?? []
      ).filter((capability) => can(capability));
      for (const capability of capabilities) {
        await grant.mutateAsync({ name: roleName, capability, granted: true });
      }
      notify.success(localize('com_admin_role_created'));
      onOpenChange(false);
      navigate(encodeURIComponent(roleName));
    } catch (error) {
      notify.error(error);
    }
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_admin_role_add')}
        className="max-w-lg"
        main={
          <div className="flex flex-col gap-4">
            <Field
              label={localize('com_admin_field_name')}
              hint={localize('com_admin_role_name_hint')}
            >
              {(id, describedBy) => (
                <Input
                  id={id}
                  dir="ltr"
                  aria-describedby={describedBy}
                  aria-invalid={name.length > 0 && !isValid}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            <Field label={localize('com_admin_field_description')}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <Label>{localize('com_admin_role_preset')}</Label>
              <Dropdown
                portal={false}
                variant="field"
                ariaLabel={localize('com_admin_role_preset')}
                value={preset}
                onChange={setPreset}
                options={ROLE_PRESETS.map((item) => ({
                  value: item.value,
                  label: localize(item.labelKey),
                }))}
              />
              <p className="text-xs text-text-secondary">
                {localize('com_admin_role_preset_hint')}
              </p>
            </div>
          </div>
        }
        selection={
          <Button onClick={submit} disabled={!isValid || isSaving}>
            {isSaving ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}

export default function RolesPage() {
  const localize = useLocalize();
  const { can } = useAdmin();
  const roles = useAdminRolesQuery();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_roles')}
        description={localize('com_admin_roles_description')}
        actions={
          can(Cap.MANAGE_ROLES) && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {localize('com_admin_role_add')}
            </Button>
          )
        }
      />
      <QueryState
        query={roles}
        isEmpty={(data) => data.roles.length === 0}
        empty={<Empty icon={ShieldCheck} title={localize('com_admin_roles_empty')} />}
      >
        {(data) => (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.roles.map((role) => (
              <Link
                key={role.name}
                to={encodeURIComponent(role.name)}
                className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
              >
                <Panel className="h-full transition-colors duration-theme-fast hover:bg-surface-hover motion-reduce:transition-none">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text-primary" dir="ltr">
                      {role.name}
                    </span>
                    {isSystemRoleName(role.name) && (
                      <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
                        {localize('com_admin_role_system')}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-text-secondary">
                    {role.description ||
                      localize(
                        SYSTEM_ROLE_DESCRIPTIONS[role.name] ?? 'com_admin_role_no_description',
                      )}
                  </p>
                </Panel>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
      <CreateRoleDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
