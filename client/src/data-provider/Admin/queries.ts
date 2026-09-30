import { useQueries, useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type {
  TProviders,
  TUsageParams,
  TUsageReport,
  TAdminSession,
  TModelCatalog,
  TAdminOverview,
  TAdminSettings,
  TAdminUserParams,
  TAdminUsersPage,
  TAdminRolesPage,
  TAdminAgentsPage,
  TAdminTools,
  TAdminSections,
  TAdminAgentPolicy,
  TAdminMCPServersPage,
  TAdminMCPServersParams,
  TAdminGroupsPage,
  TAdminGroupRecord,
  TEffectiveAccess,
  TPrincipalAccess,
  TUsageLimitEntry,
  TAdminAgentsParams,
  TAdminMembersPage,
  TAdminAuditLogPage,
  TAdminAuditLogParams,
  AdminUserSearchResult,
  TAdminGrant,
  TAdminRole,
  TAdminUser,
  TPlugin,
} from 'librechat-data-provider';
import type { UseQueryOptions, UseQueryResult } from '@tanstack/react-query';

type Options<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;

const defaults = { refetchOnWindowFocus: false, retry: false } as const;

export const useAdminSessionQuery = (
  enabled = true,
  config?: Options<TAdminSession>,
): UseQueryResult<TAdminSession> =>
  useQuery<TAdminSession>([QueryKeys.adminSession], () => dataService.getAdminSession(), {
    ...defaults,
    staleTime: 60_000,
    enabled,
    ...config,
  });

export const useAdminOverviewQuery = (timeZone?: string): UseQueryResult<TAdminOverview> =>
  useQuery<TAdminOverview>(
    [QueryKeys.adminOverview, timeZone],
    () => dataService.getAdminOverview(timeZone),
    { ...defaults, staleTime: 30_000 },
  );

export const useAdminSettingsQuery = (enabled = true): UseQueryResult<TAdminSettings> =>
  useQuery<TAdminSettings>([QueryKeys.adminSettings], () => dataService.getAdminSettings(), {
    ...defaults,
    enabled,
  });

export const useAdminUsersQuery = (params: TAdminUserParams): UseQueryResult<TAdminUsersPage> =>
  useQuery<TAdminUsersPage>(
    [QueryKeys.adminUsers, params],
    () => dataService.listAdminUsers(params),
    { ...defaults, keepPreviousData: true },
  );

export const useAdminUserQuery = (id?: string): UseQueryResult<{ user: TAdminUser }> =>
  useQuery<{ user: TAdminUser }>(
    [QueryKeys.adminUser, id],
    () => dataService.getAdminUser(id ?? ''),
    { ...defaults, enabled: !!id },
  );

export const useAdminUserSearchQuery = (
  q: string,
): UseQueryResult<{ users: AdminUserSearchResult[] }> =>
  useQuery<{ users: AdminUserSearchResult[] }>(
    [QueryKeys.adminUserSearch, q],
    () => dataService.searchAdminUsers(q),
    { ...defaults, enabled: q.trim().length >= 2, keepPreviousData: true },
  );

export const useAdminEffectiveAccessQuery = (
  id?: string,
  enabled = true,
): UseQueryResult<TEffectiveAccess> =>
  useQuery<TEffectiveAccess>(
    [QueryKeys.adminEffectiveAccess, id],
    () => dataService.getAdminEffectiveAccess(id ?? ''),
    { ...defaults, enabled: !!id && enabled },
  );

export const useAdminGroupsQuery = (
  params: { search?: string; limit?: number; offset?: number } = {},
  enabled = true,
): UseQueryResult<TAdminGroupsPage> =>
  useQuery<TAdminGroupsPage>(
    [QueryKeys.adminGroups, params],
    () => dataService.listAdminGroups(params),
    { ...defaults, keepPreviousData: true, enabled },
  );

export const useAdminGroupQuery = (id?: string): UseQueryResult<{ group: TAdminGroupRecord }> =>
  useQuery<{ group: TAdminGroupRecord }>(
    [QueryKeys.adminGroup, id],
    () => dataService.getAdminGroup(id ?? ''),
    { ...defaults, enabled: !!id },
  );

/** Resolves a handful of users by id (e.g. a group's managers) with one cached query each. */
export const useAdminUsersByIdQueries = (ids: string[]): UseQueryResult<{ user: TAdminUser }>[] =>
  useQueries({
    queries: ids.map((id) => ({
      queryKey: [QueryKeys.adminUser, id],
      queryFn: () => dataService.getAdminUser(id),
      ...defaults,
    })),
  });

export const useAdminGroupMembersQuery = (
  id?: string,
  params: { limit?: number; offset?: number } = {},
): UseQueryResult<TAdminMembersPage> =>
  useQuery<TAdminMembersPage>(
    [QueryKeys.adminGroupMembers, id, params],
    () => dataService.listAdminGroupMembers(id ?? '', params),
    { ...defaults, enabled: !!id, keepPreviousData: true },
  );

export const useAdminRolesQuery = (enabled = true): UseQueryResult<TAdminRolesPage> =>
  useQuery<TAdminRolesPage>([QueryKeys.adminRoles], () => dataService.listAdminRoles(), {
    ...defaults,
    enabled,
  });

export const useAdminRoleQuery = (name?: string): UseQueryResult<{ role: TAdminRole }> =>
  useQuery<{ role: TAdminRole }>(
    [QueryKeys.adminRole, name],
    () => dataService.getAdminRole(name ?? ''),
    { ...defaults, enabled: !!name },
  );

export const useAdminRoleMembersQuery = (
  name?: string,
  params: { limit?: number; offset?: number } = {},
): UseQueryResult<TAdminMembersPage> =>
  useQuery<TAdminMembersPage>(
    [QueryKeys.adminRoleMembers, name, params],
    () => dataService.listAdminRoleMembers(name ?? '', params),
    { ...defaults, enabled: !!name, keepPreviousData: true },
  );

export const useAdminRoleGrantsQuery = (name?: string): UseQueryResult<{ grants: TAdminGrant[] }> =>
  useQuery<{ grants: TAdminGrant[] }>(
    [QueryKeys.adminRoleGrants, name],
    () => dataService.getAdminRoleGrants(name ?? ''),
    { ...defaults, enabled: !!name },
  );

export const useAdminModelCatalogQuery = (enabled = true): UseQueryResult<TModelCatalog> =>
  useQuery<TModelCatalog>([QueryKeys.adminModelCatalog], () => dataService.getAdminModelCatalog(), {
    ...defaults,
    enabled,
  });

export const useAdminProvidersQuery = (): UseQueryResult<TProviders> =>
  useQuery<TProviders>([QueryKeys.adminProviders], () => dataService.getAdminProviders(), defaults);

export const useAdminAgentsQuery = (
  params: TAdminAgentsParams,
  enabled = true,
): UseQueryResult<TAdminAgentsPage> =>
  useQuery<TAdminAgentsPage>(
    [QueryKeys.adminAgents, params],
    () => dataService.listAdminAgents(params),
    { ...defaults, keepPreviousData: true, enabled },
  );

export const useAdminMCPServersQuery = (
  params: TAdminMCPServersParams,
  enabled = true,
): UseQueryResult<TAdminMCPServersPage> =>
  useQuery<TAdminMCPServersPage>(
    [QueryKeys.adminMCPServers, params],
    () => dataService.listAdminMCPServers(params),
    { ...defaults, keepPreviousData: true, enabled },
  );

export const useAdminSectionsQuery = (enabled = true): UseQueryResult<TAdminSections> =>
  useQuery<TAdminSections>([QueryKeys.adminSections], () => dataService.getAdminSections(), {
    ...defaults,
    enabled,
  });

export const useAdminToolsQuery = (enabled = true): UseQueryResult<TAdminTools> =>
  useQuery<TAdminTools>([QueryKeys.adminTools], () => dataService.getAdminTools(), {
    ...defaults,
    enabled,
  });

/** Tools an agent can be given (plugins and MCP tools), fetched without the chat shell's gate. */
export const useAdminAgentToolsQuery = (enabled = true): UseQueryResult<TPlugin[]> =>
  useQuery<TPlugin[]>([QueryKeys.tools], () => dataService.getAvailableAgentTools(), {
    ...defaults,
    staleTime: 60_000,
    enabled,
  });

export const useAdminAccessQuery = (
  principalType: string,
  principalId?: string,
): UseQueryResult<TPrincipalAccess> =>
  useQuery<TPrincipalAccess>(
    [QueryKeys.adminAccess, principalType, principalId],
    () => dataService.getAdminAccess(principalType, principalId ?? ''),
    { ...defaults, enabled: !!principalId },
  );

export const useAdminLimitsQuery = (): UseQueryResult<{ limits: TUsageLimitEntry[] }> =>
  useQuery<{ limits: TUsageLimitEntry[] }>(
    [QueryKeys.adminLimits],
    () => dataService.listAdminLimits(),
    defaults,
  );

export const useAdminUsageQuery = (params: TUsageParams): UseQueryResult<TUsageReport> =>
  useQuery<TUsageReport>([QueryKeys.adminUsage, params], () => dataService.getAdminUsage(params), {
    ...defaults,
    keepPreviousData: true,
  });

export const useAdminAuditLogQuery = (
  params: TAdminAuditLogParams,
): UseQueryResult<TAdminAuditLogPage> =>
  useQuery<TAdminAuditLogPage>(
    [QueryKeys.adminAuditLog, params],
    () => dataService.listAdminAuditLog(params),
    { ...defaults, keepPreviousData: true },
  );

export const useAdminAgentPolicyQuery = (enabled = true): UseQueryResult<TAdminAgentPolicy> =>
  useQuery<TAdminAgentPolicy>(
    [QueryKeys.adminAgentPolicy],
    () => dataService.getAdminAgentPolicy(),
    {
      ...defaults,
      enabled,
    },
  );
