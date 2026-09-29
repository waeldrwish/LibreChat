import { useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Pencil, Trash2, UserMinus } from 'lucide-react';
import type { TAdminGroupRecord } from 'librechat-data-provider';
import type { PickedUser } from '../common/controls';
import {
  useAdminGroupQuery,
  useAdminUsersByIdQueries,
  useAdminGroupMembersQuery,
  useDeleteAdminGroupMutation,
  useAddAdminGroupMemberMutation,
  useRemoveAdminGroupMemberMutation,
  useSetAdminGroupManagersMutation,
} from '~/data-provider';
import {
  Panel,
  LinkList,
  PageHeader,
  QueryState,
  SectionTitle,
  LinkListItem,
  useAdminNotify,
} from '../common/ui';
import { ConfirmDialog, Pager, UserPicker } from '../common/controls';
import AccessEditor from '../access/AccessEditor';
import { GroupFormDialog } from './GroupsPage';
import { Cap, useAdmin } from '../context';
import PageTabs from '../common/PageTabs';
import { useLocalize } from '~/hooks';

const MEMBERS_PAGE = 50;

function MembersTab({ group, canEdit }: { group: TAdminGroupRecord; canEdit: boolean }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState<PickedUser[]>([]);
  const members = useAdminGroupMembersQuery(group._id, { limit: MEMBERS_PAGE, offset });
  const add = useAddAdminGroupMemberMutation();
  const remove = useRemoveAdminGroupMemberMutation();

  const addMembers = async () => {
    try {
      for (const user of adding) {
        await add.mutateAsync({ id: group._id, userId: user.id });
      }
      notify.success(localize('com_admin_members_added'));
      setAdding([]);
    } catch (error) {
      notify.error(error);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <Panel>
          <SectionTitle>{localize('com_admin_members_add')}</SectionTitle>
          <UserPicker
            label={localize('com_admin_members_add')}
            selected={adding}
            onChange={setAdding}
          />
          <div className="mt-3 flex justify-end">
            <Button onClick={addMembers} disabled={adding.length === 0 || add.isLoading}>
              {add.isLoading ? <Spinner className="size-4" /> : localize('com_admin_add')}
            </Button>
          </div>
        </Panel>
      )}
      <Panel>
        <SectionTitle>{localize('com_admin_field_members')}</SectionTitle>
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
              <LinkList className="divide-y divide-border-light">
                {data.members.map((member) => (
                  <LinkListItem
                    key={member.userId}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <Link to={`../../users/${member.userId}`} relative="path" className="min-w-0">
                      <span className="block truncate text-sm text-text-primary hover:underline">
                        {member.name || member.email}
                      </span>
                      <span className="block truncate text-xs text-text-secondary" dir="ltr">
                        {member.email}
                      </span>
                    </Link>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={localize('com_admin_members_remove', {
                          0: member.name || member.email,
                        })}
                        disabled={remove.isLoading}
                        onClick={() =>
                          remove.mutate(
                            { id: group._id, userId: member.userId },
                            { onError: notify.error },
                          )
                        }
                      >
                        <UserMinus className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </LinkListItem>
                ))}
              </LinkList>
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
    </div>
  );
}

function ManagersEditor({
  group,
  initial,
  canEdit,
}: {
  group: TAdminGroupRecord;
  initial: PickedUser[];
  canEdit: boolean;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const save = useSetAdminGroupManagersMutation();
  const [managers, setManagers] = useState<PickedUser[]>(initial);

  if (!canEdit) {
    return (
      <ul className="text-sm">
        {managers.map((user) => (
          <li key={user.id}>{user.name || user.email}</li>
        ))}
      </ul>
    );
  }
  return (
    <>
      <UserPicker
        label={localize('com_admin_field_managers')}
        selected={managers}
        onChange={setManagers}
      />
      <div className="mt-3 flex justify-end">
        <Button
          disabled={save.isLoading}
          onClick={() =>
            save.mutate(
              { id: group._id, managerIds: managers.map((user) => user.id) },
              {
                onSuccess: () => notify.success(localize('com_admin_saved')),
                onError: notify.error,
              },
            )
          }
        >
          {save.isLoading ? <Spinner className="size-4" /> : localize('com_admin_save')}
        </Button>
      </div>
    </>
  );
}

function ManagersTab({ group, canEdit }: { group: TAdminGroupRecord; canEdit: boolean }) {
  const localize = useLocalize();
  const managerIds = group.managerIds ?? [];
  const managerQueries = useAdminUsersByIdQueries(managerIds);
  const loaded = managerQueries.every((query) => !query.isLoading);
  const initial = managerQueries
    .map((query) => query.data?.user)
    .filter((user): user is NonNullable<typeof user> => user != null)
    .map((user) => ({ id: user.id, name: user.name, email: user.email }));

  return (
    <Panel>
      <SectionTitle>{localize('com_admin_field_managers')}</SectionTitle>
      <p className="mb-3 text-sm text-text-secondary">
        {localize('com_admin_managers_description')}
      </p>
      {loaded ? (
        <ManagersEditor
          key={managerIds.join(',')}
          group={group}
          initial={initial}
          canEdit={canEdit}
        />
      ) : (
        <Spinner className="size-5 text-text-secondary" />
      )}
    </Panel>
  );
}

function GroupDetail({ group }: { group: TAdminGroupRecord }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const navigate = useNavigate();
  const { can } = useAdmin();
  const canEdit = can(Cap.MANAGE_GROUPS) && group.source === 'local';
  const remove = useDeleteAdminGroupMutation();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <PageHeader
        title={group.name}
        description={group.description}
        actions={
          canEdit && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden="true" />
                {localize('com_admin_edit')}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setDeleting(true)}>
                <Trash2 className="size-4" aria-hidden="true" />
                {localize('com_admin_delete')}
              </Button>
            </>
          )
        }
      />
      <PageTabs
        label={localize('com_admin_group_sections')}
        tabs={[
          {
            value: 'members',
            label: localize('com_admin_field_members'),
            content: <MembersTab group={group} canEdit={canEdit} />,
          },
          {
            value: 'managers',
            label: localize('com_admin_field_managers'),
            content: <ManagersTab group={group} canEdit={can(Cap.MANAGE_GROUPS)} />,
          },
          {
            value: 'access',
            label: localize('com_admin_tab_access'),
            content: <AccessEditor principalType="group" principalId={group._id} />,
          },
        ]}
      />
      <GroupFormDialog open={editing} onOpenChange={setEditing} group={group} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={localize('com_admin_group_delete')}
        description={localize('com_admin_group_delete_confirm', { 0: group.name })}
        confirmLabel={localize('com_admin_delete')}
        destructive={true}
        isLoading={remove.isLoading}
        onConfirm={() =>
          remove.mutate(group._id, {
            onSuccess: () => {
              notify.success(localize('com_admin_group_deleted'));
              navigate('..', { relative: 'path' });
            },
            onError: notify.error,
          })
        }
      />
    </>
  );
}

export default function GroupDetailPage() {
  const localize = useLocalize();
  const { id } = useParams();
  const query = useAdminGroupQuery(id);
  return (
    <>
      <Link
        to=".."
        relative="path"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
        {localize('com_admin_nav_groups')}
      </Link>
      <QueryState query={query}>{(data) => <GroupDetail group={data.group} />}</QueryState>
    </>
  );
}
