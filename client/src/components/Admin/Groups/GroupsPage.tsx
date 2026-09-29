import { useState } from 'react';
import { UsersRound, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Input,
  Table,
  Button,
  Spinner,
  OGDialog,
  Textarea,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  OGDialogTemplate,
} from '@librechat/client';
import type { TAdminGroupRecord } from 'librechat-data-provider';
import {
  useAdminGroupsQuery,
  useCreateAdminGroupMutation,
  useUpdateAdminGroupMutation,
} from '~/data-provider';
import { Empty, PageHeader, Panel, QueryState, useAdminNotify } from '../common/ui';
import { Field, Pager, SearchBox } from '../common/controls';
import { useLocalize, useDebounce } from '~/hooks';
import { useAdminFormat } from '../common/format';
import { Cap, useAdmin } from '../context';

const PAGE_SIZE = 25;

/** Creates a group, or renames/re-describes one when `group` is given. */
export function GroupFormDialog({
  open,
  onOpenChange,
  group,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: TAdminGroupRecord;
  onSaved?: (group: TAdminGroupRecord) => void;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const create = useCreateAdminGroupMutation();
  const update = useUpdateAdminGroupMutation();
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const isSaving = create.isLoading || update.isLoading;

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName(group?.name ?? '');
      setDescription(group?.description ?? '');
    }
    onOpenChange(next);
  };

  const submit = () => {
    const body = { name: name.trim(), description: description.trim() };
    const handlers = {
      onSuccess: (result: { group: TAdminGroupRecord }) => {
        notify.success(localize(group ? 'com_admin_saved' : 'com_admin_group_created'));
        onOpenChange(false);
        onSaved?.(result.group);
      },
      onError: notify.error,
    };
    if (group) {
      update.mutate({ id: group._id, body }, handlers);
    } else {
      create.mutate(body, handlers);
    }
  };

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      <OGDialogTemplate
        title={localize(group ? 'com_admin_group_edit' : 'com_admin_group_add')}
        className="max-w-lg"
        main={
          <div className="flex flex-col gap-4">
            <Field label={localize('com_admin_field_name')}>
              {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label={localize('com_admin_field_description')}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              )}
            </Field>
          </div>
        }
        selection={
          <Button onClick={submit} disabled={!name.trim() || isSaving}>
            {isSaving ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}

export default function GroupsPage() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const format = useAdminFormat();
  const { can } = useAdmin();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search, 300);
  const groups = useAdminGroupsQuery({ search: debounced || undefined, limit: PAGE_SIZE, offset });

  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_groups')}
        description={localize('com_admin_groups_description')}
        actions={
          can(Cap.MANAGE_GROUPS) && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {localize('com_admin_group_add')}
            </Button>
          )
        }
      />
      <Panel>
        <div className="mb-4">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setOffset(0);
            }}
            placeholder={localize('com_admin_groups_search')}
          />
        </div>
        <QueryState
          query={groups}
          isEmpty={(data) => data.groups.length === 0}
          empty={
            <Empty
              icon={UsersRound}
              title={localize('com_admin_groups_empty')}
              description={localize('com_admin_groups_empty_description')}
            />
          }
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{localize('com_admin_field_name')}</TableHead>
                    <TableHead>{localize('com_admin_field_members')}</TableHead>
                    <TableHead className="max-md:hidden">
                      {localize('com_admin_field_managers')}
                    </TableHead>
                    <TableHead className="max-md:hidden">
                      {localize('com_admin_field_source')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.groups.map((group) => (
                    <TableRow
                      key={group._id}
                      className="cursor-pointer"
                      onClick={() => navigate(group._id)}
                    >
                      <TableCell>
                        <Link
                          to={group._id}
                          onClick={(event) => event.stopPropagation()}
                          className="font-medium text-text-primary hover:underline"
                        >
                          {group.name}
                        </Link>
                        {group.description && (
                          <span className="block truncate text-xs text-text-secondary">
                            {group.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {format.number(group.memberIds?.length ?? 0)}
                      </TableCell>
                      <TableCell className="tabular-nums max-md:hidden">
                        {format.number(group.managerIds?.length ?? 0)}
                      </TableCell>
                      <TableCell className="text-text-secondary max-md:hidden">
                        {localize(
                          group.source === 'entra'
                            ? 'com_admin_group_source_entra'
                            : 'com_admin_group_source_local',
                        )}
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
      <GroupFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(group) => navigate(`${group._id}?tab=members`)}
      />
    </>
  );
}
