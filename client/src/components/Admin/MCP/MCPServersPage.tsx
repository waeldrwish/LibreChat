import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, Pencil, Plug, Plus } from 'lucide-react';
import { QueryKeys, ResourceType, PermissionBits } from 'librechat-data-provider';
import { useGetAllEffectivePermissionsQuery } from 'librechat-data-provider/react-query';
import {
  Table,
  Button,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from '@librechat/client';
import type { TAdminMCPServer } from 'librechat-data-provider';
import type { MCPServerDefinition } from '~/hooks';
import { Empty, Panel, PageHeader, QueryState, SectionTitle } from '../common/ui';
import { useAdminMCPServersQuery, useMCPServersQuery } from '~/data-provider';
import { MCPServerDialog } from '~/components/SidePanel/MCPBuilder';
import { GenericGrantAccessDialog } from '~/components/Sharing';
import { Pager, SearchBox } from '../common/controls';
import { useLocalize, useDebounce } from '~/hooks';
import { useAdminFormat } from '../common/format';
import { Cap, useAdmin } from '../context';

const PAGE_SIZE = 25;

type DialogTarget = { server: MCPServerDefinition | null };

/**
 * The servers this administrator can edit through the regular MCP API, keyed by id.
 * Others appear in the inventory with their access controls only; granting yourself
 * edit access from there makes them editable here too.
 */
function useEditableServers(): Map<string, MCPServerDefinition> {
  const { data: servers } = useMCPServersQuery();
  const { data: permissions } = useGetAllEffectivePermissionsQuery(ResourceType.MCPSERVER);
  return useMemo(() => {
    const editable = new Map<string, MCPServerDefinition>();
    for (const [serverName, entry] of Object.entries(servers ?? {})) {
      const { dbId, consumeOnly, requestScoped, ...config } = entry;
      const bits = dbId ? (permissions?.[dbId] ?? 0) : 0;
      if (dbId && (bits & PermissionBits.EDIT) !== 0) {
        editable.set(dbId, {
          serverName,
          dbId,
          effectivePermissions: bits,
          consumeOnly,
          requestScoped,
          config,
        });
      }
    }
    return editable;
  }, [servers, permissions]);
}

function Transport({ transport, url }: { transport?: string; url?: string }) {
  return (
    <span className="block min-w-0">
      <span className="block text-text-primary">
        <span dir="ltr">{transport ?? '—'}</span>
      </span>
      {url && (
        <span className="block truncate text-xs text-text-secondary">
          <span dir="ltr">{url}</span>
        </span>
      )}
    </span>
  );
}

export default function MCPServersPage() {
  const localize = useLocalize();
  const format = useAdminFormat();
  const { can } = useAdmin();
  const queryClient = useQueryClient();
  const canManageRoles = can(Cap.MANAGE_ROLES);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const debounced = useDebounce(search, 300);
  const servers = useAdminMCPServersQuery({
    search: debounced || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const editable = useEditableServers();
  const refresh = () => queryClient.invalidateQueries([QueryKeys.adminMCPServers]);

  const sharingLabel = (server: TAdminMCPServer) =>
    server.sharedWith === 0 && !server.isPublic
      ? localize('com_admin_mcp_private')
      : localize('com_admin_agent_shared_count', { 0: format.number(server.sharedWith) });

  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_mcp')}
        description={localize('com_admin_mcp_description')}
        actions={
          <Button onClick={() => setDialog({ server: null })}>
            <Plus className="size-4" aria-hidden="true" />
            {localize('com_admin_mcp_add')}
          </Button>
        }
      />
      <Panel className="mb-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setOffset(0);
            }}
            placeholder={localize('com_admin_mcp_search')}
          />
        </div>
        <QueryState
          query={servers}
          isEmpty={(data) => data.servers.length === 0}
          empty={<Empty icon={Plug} title={localize('com_admin_mcp_empty')} />}
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{localize('com_admin_field_name')}</TableHead>
                    <TableHead className="max-md:hidden">
                      {localize('com_admin_mcp_transport')}
                    </TableHead>
                    <TableHead className="max-lg:hidden">
                      {localize('com_admin_agent_owner')}
                    </TableHead>
                    <TableHead>{localize('com_admin_agent_shared')}</TableHead>
                    <TableHead className="max-lg:hidden">
                      {localize('com_admin_field_updated')}
                    </TableHead>
                    <TableHead>
                      <span className="sr-only">{localize('com_admin_actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.servers.map((server) => {
                    const definition = editable.get(server.dbId);
                    const name = server.title || server.serverName;
                    return (
                      <TableRow key={server.dbId}>
                        <TableCell>
                          <span className="block font-medium">{name}</span>
                          <span className="block text-xs text-text-secondary">
                            <span dir="ltr">{server.serverName}</span>
                          </span>
                          {server.description && (
                            <span className="line-clamp-1 text-xs text-text-secondary">
                              {server.description}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-64 max-md:hidden">
                          <Transport transport={server.transport} url={server.url} />
                        </TableCell>
                        <TableCell className="text-text-secondary max-lg:hidden">
                          {server.authorName || '—'}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-text-secondary">
                            {server.isPublic && (
                              <Globe
                                className="size-3.5"
                                aria-label={localize('com_admin_agent_public')}
                              />
                            )}
                            {sharingLabel(server)}
                          </span>
                        </TableCell>
                        <TableCell className="text-text-secondary max-lg:hidden">
                          {format.date(server.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {definition && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={localize('com_admin_mcp_edit_named', { 0: name })}
                                onClick={() => setDialog({ server: definition })}
                              >
                                <Pencil className="size-4" aria-hidden="true" />
                              </Button>
                            )}
                            <GenericGrantAccessDialog
                              resourceDbId={server.dbId}
                              resourceName={name}
                              resourceType={ResourceType.MCPSERVER}
                              onGrantAccess={refresh}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
        <p className="mt-3 text-xs text-text-secondary">
          {localize('com_admin_mcp_edit_hint')}{' '}
          {canManageRoles && (
            <Link to="../roles" relative="path" className="underline">
              {localize('com_admin_mcp_roles_link')}
            </Link>
          )}
        </p>
      </Panel>

      {servers.data && servers.data.configured.length > 0 && (
        <Panel>
          <SectionTitle>{localize('com_admin_mcp_configured')}</SectionTitle>
          <p className="mb-3 text-sm text-text-secondary">
            {localize('com_admin_providers_configured_description')}
          </p>
          <ul className="divide-y divide-border-light">
            {servers.data.configured.map((server) => (
              <li key={server.serverName} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {server.title || server.serverName}
                  </span>
                  {server.description && (
                    <span className="line-clamp-1 text-xs text-text-secondary">
                      {server.description}
                    </span>
                  )}
                </span>
                <span className="max-w-[50%] shrink-0 text-end text-xs">
                  <Transport transport={server.transport} url={server.url} />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {dialog && (
        <MCPServerDialog
          open={true}
          server={dialog.server}
          onOpenChange={(open) => {
            if (!open) {
              setDialog(null);
              refresh();
            }
          }}
        />
      )}
    </>
  );
}
