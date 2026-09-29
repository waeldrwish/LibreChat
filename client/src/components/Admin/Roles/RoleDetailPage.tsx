import { useState } from 'react';
import { ArrowRight, Trash2 } from 'lucide-react';
import { Button, Checkbox, Switch } from '@librechat/client';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SystemRoles, isSystemRoleName } from 'librechat-data-provider';
import type { PermissionTypes, Permissions, TAdminRole } from 'librechat-data-provider';
import {
  useAdminRoleQuery,
  useAdminRoleGrantsQuery,
  useAdminRoleMembersQuery,
  useDeleteAdminRoleMutation,
  useToggleAdminRoleGrantMutation,
  useUpdateAdminRolePermissionsMutation,
} from '~/data-provider';
import { CAPABILITY_GROUPS, PERMISSION_LABELS, PERMISSION_TYPE_LABELS } from './capabilities';
import { PageHeader, Panel, QueryState, SectionTitle, useAdminNotify } from '../common/ui';
import { ConfirmDialog, Pager } from '../common/controls';
import AccessEditor from '../access/AccessEditor';
import { Cap, useAdmin } from '../context';
import PageTabs from '../common/PageTabs';
import { useLocalize } from '~/hooks';

function CapabilitiesTab({ role }: { role: TAdminRole }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const { can } = useAdmin();
  const grants = useAdminRoleGrantsQuery(role.name);
  const toggle = useToggleAdminRoleGrantMutation();
  const canEdit = can(Cap.MANAGE_ROLES) && role.name !== SystemRoles.ADMIN;

  return (
    <QueryState query={grants}>
      {(data) => {
        const held = new Set(data.grants.map((grant) => grant.capability));
        return (
          <div className="flex flex-col gap-4">
            {role.name === SystemRoles.ADMIN && (
              <p className="rounded-lg border border-border-light bg-surface-tertiary p-3 text-sm text-text-secondary">
                {localize('com_admin_role_admin_locked')}
              </p>
            )}
            {CAPABILITY_GROUPS.map((group) => (
              <Panel key={group.labelKey}>
                <SectionTitle>{localize(group.labelKey)}</SectionTitle>
                <ul className="flex flex-col gap-3">
                  {group.items.map((item) => {
                    const id = `cap-${item.capability}`;
                    return (
                      <li key={item.capability} className="flex items-start gap-3">
                        <Checkbox
                          id={id}
                          aria-label={localize(item.labelKey)}
                          checked={held.has(item.capability)}
                          disabled={!canEdit || toggle.isLoading || !can(item.capability)}
                          onCheckedChange={(checked) =>
                            toggle.mutate(
                              {
                                name: role.name,
                                capability: item.capability,
                                granted: checked === true,
                              },
                              { onError: notify.error },
                            )
                          }
                        />
                        <label htmlFor={id} className="text-sm leading-4 text-text-primary">
                          {localize(item.labelKey)}
                          <span className="ms-2 text-xs text-text-secondary" dir="ltr">
                            {item.capability}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            ))}
          </div>
        );
      }}
    </QueryState>
  );
}

function FeaturesTab({ role }: { role: TAdminRole }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const { can } = useAdmin();
  const update = useUpdateAdminRolePermissionsMutation();
  const canEdit = can(Cap.MANAGE_ROLES);
  const entries = Object.entries(role.permissions ?? {}) as [
    PermissionTypes,
    Partial<Record<Permissions, boolean>>,
  ][];

  return (
    <Panel>
      <SectionTitle>{localize('com_admin_role_features')}</SectionTitle>
      <p className="mb-4 text-sm text-text-secondary">
        {localize('com_admin_role_features_description')}
      </p>
      <ul className="divide-y divide-border-light">
        {entries
          .filter(([type]) => PERMISSION_TYPE_LABELS[type] != null)
          .map(([type, permissions]) => (
            <li key={type} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="text-sm font-medium text-text-primary">
                {localize(PERMISSION_TYPE_LABELS[type]!)}
              </span>
              <div className="flex flex-wrap gap-4">
                {(Object.entries(permissions ?? {}) as [Permissions, boolean][]).map(
                  ([permission, value]) => {
                    const label = PERMISSION_LABELS[permission];
                    const text = label ? localize(label) : permission;
                    return (
                      <label key={permission} className="flex items-center gap-2 text-xs">
                        <Switch
                          aria-label={`${localize(PERMISSION_TYPE_LABELS[type]!)} — ${text}`}
                          checked={value === true}
                          disabled={!canEdit || update.isLoading}
                          onCheckedChange={(checked) =>
                            update.mutate(
                              {
                                name: role.name,
                                permissions: {
                                  [type]: { [permission]: checked },
                                } as TAdminRole['permissions'],
                              },
                              { onError: notify.error },
                            )
                          }
                        />
                        <span className="text-text-secondary">{text}</span>
                      </label>
                    );
                  },
                )}
              </div>
            </li>
          ))}
      </ul>
    </Panel>
  );
}

function MembersTab({ role }: { role: TAdminRole }) {
  const localize = useLocalize();
  const [offset, setOffset] = useState(0);
  const members = useAdminRoleMembersQuery(role.name, { limit: 50, offset });
  return (
    <Panel>
      <SectionTitle>{localize('com_admin_field_members')}</SectionTitle>
      <p className="mb-3 text-sm text-text-secondary">{localize('com_admin_role_members_hint')}</p>
      <QueryState
        query={members}
        isEmpty={(data) => data.members.length === 0}
        empty={
          <p className="py-6 text-center text-sm text-text-secondary">
            {localize('com_admin_members_empty')}
          </p>
        }
      >
        {(data) => (
          <>
            <ul className="divide-y divide-border-light">
              {data.members.map((member) => (
                <li key={member.userId} className="py-2">
                  <Link
                    to={`../../users/${member.userId}`}
                    relative="path"
                    className="text-sm text-text-primary hover:underline"
                  >
                    {member.name || member.email}
                  </Link>
                  <span className="ms-2 text-xs text-text-secondary" dir="ltr">
                    {member.email}
                  </span>
                </li>
              ))}
            </ul>
            <Pager
              total={data.total}
              limit={data.limit}
              offset={data.offset}
              onChange={setOffset}
            />
          </>
        )}
      </QueryState>
    </Panel>
  );
}

function RoleDetail({ role }: { role: TAdminRole }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const navigate = useNavigate();
  const { can } = useAdmin();
  const remove = useDeleteAdminRoleMutation();
  const [deleting, setDeleting] = useState(false);
  const isSystem = isSystemRoleName(role.name);

  return (
    <>
      <PageHeader
        title={role.name}
        description={role.description}
        actions={
          can(Cap.MANAGE_ROLES) &&
          !isSystem && (
            <Button variant="destructive" size="sm" onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" aria-hidden="true" />
              {localize('com_admin_delete')}
            </Button>
          )
        }
      />
      <PageTabs
        label={localize('com_admin_role_sections')}
        tabs={[
          {
            value: 'capabilities',
            label: localize('com_admin_role_capabilities'),
            content: <CapabilitiesTab role={role} />,
          },
          {
            value: 'features',
            label: localize('com_admin_role_features'),
            content: <FeaturesTab role={role} />,
          },
          {
            value: 'members',
            label: localize('com_admin_field_members'),
            content: <MembersTab role={role} />,
          },
          {
            value: 'access',
            label: localize('com_admin_tab_access'),
            content: <AccessEditor principalType="role" principalId={role.name} />,
          },
        ]}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={localize('com_admin_role_delete')}
        description={localize('com_admin_role_delete_confirm', { 0: role.name })}
        confirmLabel={localize('com_admin_delete')}
        destructive={true}
        isLoading={remove.isLoading}
        onConfirm={() =>
          remove.mutate(role.name, {
            onSuccess: () => {
              notify.success(localize('com_admin_role_deleted'));
              navigate('..', { relative: 'path' });
            },
            onError: notify.error,
          })
        }
      />
    </>
  );
}

export default function RoleDetailPage() {
  const localize = useLocalize();
  const { name } = useParams();
  const query = useAdminRoleQuery(name);
  return (
    <>
      <Link
        to=".."
        relative="path"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
        {localize('com_admin_nav_roles')}
      </Link>
      <QueryState query={query}>{(data) => <RoleDetail role={data.role} />}</QueryState>
    </>
  );
}
