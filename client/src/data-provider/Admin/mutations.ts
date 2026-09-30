import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TModelPolicy,
  TManagedProvider,
  TModelPolicyInput,
  TModelPolicyUpdate,
  TGovernanceConfig,
  TAdminGroupInput,
  TPrincipalAccess,
  TPrincipalAccessUpdate,
  TAdminToolUpdate,
  TAdminCreateUserRequest,
  TAdminUpdateUserRequest,
  TAdminRole,
  TAdminUser,
} from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';

/**
 * A mutation that refreshes every admin query it can affect. Admin reads are cheap
 * and a stale list after a change is the failure users notice, so invalidation
 * errs on the side of the whole family.
 */
function useAdminMutation<TData, TVars>(
  mutate: (vars: TVars) => Promise<TData>,
  invalidate: QueryKeys[],
): UseMutationResult<TData, unknown, TVars> {
  const queryClient = useQueryClient();
  return useMutation(mutate, {
    onSuccess: () =>
      Promise.all(invalidate.map((key) => queryClient.invalidateQueries([key]))).then(
        () => undefined,
      ),
  });
}

const USER_KEYS = [
  QueryKeys.adminUsers,
  QueryKeys.adminUser,
  QueryKeys.adminOverview,
  QueryKeys.adminGroupMembers,
  QueryKeys.adminRoleMembers,
  QueryKeys.adminEffectiveAccess,
];
const GROUP_KEYS = [
  QueryKeys.adminGroups,
  QueryKeys.adminGroup,
  QueryKeys.adminGroupMembers,
  QueryKeys.adminUsers,
];
const ROLE_KEYS = [QueryKeys.adminRoles, QueryKeys.adminRole, QueryKeys.adminRoleGrants];
const MODEL_KEYS = [
  QueryKeys.adminModelCatalog,
  QueryKeys.adminAccess,
  QueryKeys.adminEffectiveAccess,
  QueryKeys.adminOverview,
  QueryKeys.models,
];
const ACCESS_KEYS = [
  QueryKeys.adminAccess,
  QueryKeys.adminEffectiveAccess,
  QueryKeys.adminLimits,
  QueryKeys.adminModelCatalog,
  QueryKeys.adminAgents,
];

export const useCreateAdminUserMutation = () =>
  useAdminMutation<{ user: TAdminUser }, TAdminCreateUserRequest>(
    (body) => dataService.createAdminUser(body),
    USER_KEYS,
  );

export const useUpdateAdminUserMutation = () =>
  useAdminMutation<{ user: TAdminUser }, { id: string; body: TAdminUpdateUserRequest }>(
    ({ id, body }) => dataService.updateAdminUser(id, body),
    USER_KEYS,
  );

export const useSetAdminUserStatusMutation = () =>
  useAdminMutation<{ user: TAdminUser }, { id: string; disabled: boolean }>(
    ({ id, disabled }) => dataService.setAdminUserStatus(id, disabled),
    USER_KEYS,
  );

export const useResetAdminUserPasswordMutation = () =>
  useAdminMutation<{ success: true }, { id: string; password: string }>(
    ({ id, password }) => dataService.resetAdminUserPassword(id, password),
    [],
  );

export const useCreateAdminGroupMutation = () =>
  useAdminMutation((body: TAdminGroupInput) => dataService.createAdminGroup(body), GROUP_KEYS);

export const useUpdateAdminGroupMutation = () =>
  useAdminMutation(
    ({ id, body }: { id: string; body: Partial<TAdminGroupInput> }) =>
      dataService.updateAdminGroup(id, body),
    GROUP_KEYS,
  );

export const useDeleteAdminGroupMutation = () =>
  useAdminMutation((id: string) => dataService.deleteAdminGroup(id), GROUP_KEYS);

export const useAddAdminGroupMemberMutation = () =>
  useAdminMutation(
    ({ id, userId }: { id: string; userId: string }) => dataService.addAdminGroupMember(id, userId),
    GROUP_KEYS,
  );

export const useRemoveAdminGroupMemberMutation = () =>
  useAdminMutation(
    ({ id, userId }: { id: string; userId: string }) =>
      dataService.removeAdminGroupMember(id, userId),
    GROUP_KEYS,
  );

export const useSetAdminGroupManagersMutation = () =>
  useAdminMutation(
    ({ id, managerIds }: { id: string; managerIds: string[] }) =>
      dataService.setAdminGroupManagers(id, managerIds),
    GROUP_KEYS,
  );

export const useCreateAdminRoleMutation = () =>
  useAdminMutation(
    (body: { name: string; description?: string }) => dataService.createAdminRole(body),
    ROLE_KEYS,
  );

export const useUpdateAdminRoleMutation = () =>
  useAdminMutation(
    ({ name, body }: { name: string; body: { name?: string; description?: string } }) =>
      dataService.updateAdminRole(name, body),
    ROLE_KEYS,
  );

export const useDeleteAdminRoleMutation = () =>
  useAdminMutation((name: string) => dataService.deleteAdminRole(name), ROLE_KEYS);

export const useUpdateAdminRolePermissionsMutation = () =>
  useAdminMutation(
    ({ name, permissions }: { name: string; permissions: TAdminRole['permissions'] }) =>
      dataService.updateAdminRolePermissions(name, permissions),
    [...ROLE_KEYS, QueryKeys.roles],
  );

export const useToggleAdminRoleGrantMutation = () =>
  useAdminMutation(
    ({ name, capability, granted }: { name: string; capability: string; granted: boolean }) =>
      granted
        ? dataService.assignAdminRoleGrant(name, capability)
        : dataService.revokeAdminRoleGrant(name, capability),
    [QueryKeys.adminRoleGrants, QueryKeys.adminSession],
  );

export const useCreateAdminModelPolicyMutation = () =>
  useAdminMutation<{ policy: TModelPolicy }, TModelPolicyInput>(
    (body) => dataService.createAdminModelPolicy(body),
    MODEL_KEYS,
  );

export const useUpdateAdminModelPolicyMutation = () =>
  useAdminMutation<{ policy: TModelPolicy }, { id: string; body: TModelPolicyUpdate }>(
    ({ id, body }) => dataService.updateAdminModelPolicy(id, body),
    MODEL_KEYS,
  );

export const useDeleteAdminModelPolicyMutation = () =>
  useAdminMutation((id: string) => dataService.deleteAdminModelPolicy(id), MODEL_KEYS);

export const useUpdateAdminProvidersMutation = () =>
  useAdminMutation(
    (providers: TManagedProvider[]) => dataService.updateAdminProviders(providers),
    [QueryKeys.adminProviders, QueryKeys.adminModelCatalog, QueryKeys.models, QueryKeys.endpoints],
  );

export const useSetAdminAgentStatusMutation = () =>
  useAdminMutation(
    ({ id, disabled }: { id: string; disabled: boolean }) =>
      dataService.setAdminAgentStatus(id, disabled),
    [QueryKeys.adminAgents, QueryKeys.adminOverview, QueryKeys.agents],
  );

export const useUpdateAdminToolMutation = () =>
  useAdminMutation(
    ({ key, update }: { key: string; update: TAdminToolUpdate }) =>
      dataService.updateAdminTool(key, update),
    [QueryKeys.adminTools, QueryKeys.tools, QueryKeys.adminAuditLog],
  );

export const useUpdateAdminAccessMutation = () =>
  useAdminMutation<
    TPrincipalAccess,
    { principalType: string; principalId: string; body: TPrincipalAccessUpdate }
  >(
    ({ principalType, principalId, body }) =>
      dataService.updateAdminAccess(principalType, principalId, body),
    ACCESS_KEYS,
  );

export const useUpdateAdminSettingsMutation = () =>
  useAdminMutation(
    (governance: TGovernanceConfig) => dataService.updateAdminSettings(governance),
    [
      QueryKeys.adminSettings,
      QueryKeys.adminSession,
      QueryKeys.adminModelCatalog,
      QueryKeys.startupConfig,
    ],
  );
