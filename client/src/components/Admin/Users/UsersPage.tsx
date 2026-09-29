import { useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Table,
  Button,
  TableRow,
  Dropdown,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from '@librechat/client';
import type { TAdminUserParams, TAdminUserStatus } from 'librechat-data-provider';
import { useAdminGroupsQuery, useAdminRolesQuery, useAdminUsersQuery } from '~/data-provider';
import { Empty, PageHeader, Panel, QueryState, StatusBadge } from '../common/ui';
import { Pager, SearchBox } from '../common/controls';
import { useLocalize, useDebounce } from '~/hooks';
import { useAdminFormat } from '../common/format';
import UserFormDialog from './UserFormDialog';
import { Cap, useAdmin } from '../context';

const PAGE_SIZE = 25;
const ALL = '__all__';

export default function UsersPage() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const format = useAdminFormat();
  const { can, isTeamScope } = useAdmin();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>(ALL);
  const [role, setRole] = useState<string>(ALL);
  const [groupId, setGroupId] = useState<string>(ALL);
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  const params: TAdminUserParams = {
    search: debouncedSearch || undefined,
    status: status === ALL ? undefined : (status as TAdminUserStatus),
    role: role === ALL ? undefined : role,
    groupId: groupId === ALL ? undefined : groupId,
    limit: PAGE_SIZE,
    offset,
  };
  const users = useAdminUsersQuery(params);
  const roles = useAdminRolesQuery(can(Cap.READ_ROLES));
  const groups = useAdminGroupsQuery({ limit: 200 }, can(Cap.READ_GROUPS));

  const resetPage =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setOffset(0);
    };

  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_users')}
        description={localize(
          isTeamScope ? 'com_admin_users_team_description' : 'com_admin_users_description',
        )}
        actions={
          can(Cap.MANAGE_USERS) && (
            <Button onClick={() => setCreating(true)}>
              <UserPlus className="size-4" aria-hidden="true" />
              {localize('com_admin_user_add')}
            </Button>
          )
        }
      />
      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox
            value={search}
            onChange={resetPage(setSearch)}
            placeholder={localize('com_admin_users_search')}
          />
          <Dropdown
            variant="field"
            className="w-40"
            ariaLabel={localize('com_admin_field_status')}
            value={status}
            onChange={resetPage(setStatus)}
            options={[
              { value: ALL, label: localize('com_admin_filter_all_statuses') },
              { value: 'active', label: localize('com_admin_status_active') },
              { value: 'disabled', label: localize('com_admin_status_disabled') },
            ]}
          />
          {roles.data && (
            <Dropdown
              variant="field"
              className="w-44"
              ariaLabel={localize('com_admin_field_role')}
              value={role}
              onChange={resetPage(setRole)}
              options={[
                { value: ALL, label: localize('com_admin_filter_all_roles') },
                ...roles.data.roles.map((item) => ({ value: item.name, label: item.name })),
              ]}
            />
          )}
          {groups.data && groups.data.groups.length > 0 && (
            <Dropdown
              variant="field"
              className="w-48"
              ariaLabel={localize('com_admin_field_group')}
              value={groupId}
              onChange={resetPage(setGroupId)}
              options={[
                { value: ALL, label: localize('com_admin_filter_all_groups') },
                ...groups.data.groups.map((group) => ({ value: group._id, label: group.name })),
              ]}
            />
          )}
        </div>
        <QueryState
          query={users}
          isEmpty={(data) => data.users.length === 0}
          empty={<Empty icon={Users} title={localize('com_admin_users_empty')} />}
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{localize('com_admin_field_name')}</TableHead>
                    <TableHead>{localize('com_admin_field_role')}</TableHead>
                    <TableHead className="max-md:hidden">
                      {localize('com_admin_field_groups')}
                    </TableHead>
                    <TableHead>{localize('com_admin_field_status')}</TableHead>
                    <TableHead className="max-lg:hidden">
                      {localize('com_admin_field_created')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.users.map((user) => (
                    <TableRow
                      key={user.id}
                      className="cursor-pointer"
                      onClick={() => navigate(user.id)}
                    >
                      <TableCell className="min-w-0">
                        <Link
                          to={user.id}
                          className="block truncate font-medium text-text-primary hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {user.name || user.username || user.email}
                        </Link>
                        <span className="block truncate text-xs text-text-secondary" dir="ltr">
                          {user.email}
                        </span>
                      </TableCell>
                      <TableCell>{user.role}</TableCell>
                      <TableCell className="max-md:hidden">
                        <span className="line-clamp-2 text-text-secondary">
                          {format.list(user.groups.map((group) => group.name)) || '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          active={!user.disabled}
                          label={localize(
                            user.disabled ? 'com_admin_status_disabled' : 'com_admin_status_active',
                          )}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-text-secondary max-lg:hidden">
                        {format.date(user.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
      <UserFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(user) => navigate(`${user.id}?tab=access`)}
      />
    </>
  );
}
