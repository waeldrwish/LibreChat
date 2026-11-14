import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';

type SpendUsageParams = Parameters<typeof dataService.getAdminPanelUsage>[0];

const adminPanelQueryOptions = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: false,
  retry: false,
};

export const useAdminPanelSummary = (
  config?: UseQueryOptions<dataService.AdminPanelSummary>,
): QueryObserverResult<dataService.AdminPanelSummary> =>
  useQuery<dataService.AdminPanelSummary>(
    [QueryKeys.adminPanelSummary],
    () => dataService.getAdminPanelSummary(),
    { ...adminPanelQueryOptions, ...config },
  );

export const useAdminPanelUsage = (
  params: SpendUsageParams,
  config?: UseQueryOptions<dataService.AdminPanelUsage>,
): QueryObserverResult<dataService.AdminPanelUsage> =>
  useQuery<dataService.AdminPanelUsage>(
    [QueryKeys.adminPanelUsage, params],
    () => dataService.getAdminPanelUsage(params),
    { ...adminPanelQueryOptions, ...config },
  );

export const useAdminPanelUsers = (limit = 50) =>
  useQuery(
    [QueryKeys.adminPanelUsers, limit],
    () => dataService.listAdminPanelUsers(limit, 0),
    adminPanelQueryOptions,
  );

export const useAdminPanelBalance = (
  userId: string,
  config?: UseQueryOptions<dataService.AdminPanelBalance>,
): QueryObserverResult<dataService.AdminPanelBalance> =>
  useQuery<dataService.AdminPanelBalance>(
    [QueryKeys.adminPanelBalance, userId],
    () => dataService.getAdminPanelBalance(userId),
    { ...adminPanelQueryOptions, ...config },
  );

export const useCreateAdminPanelUser = () => {
  const queryClient = useQueryClient();
  return useMutation(
    (body: Parameters<typeof dataService.createAdminPanelUser>[0]) =>
      dataService.createAdminPanelUser(body),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminPanelUsers]);
        queryClient.invalidateQueries([QueryKeys.adminPanelSummary]);
      },
    },
  );
};

export const useUpdateAdminPanelBalance = (userId: string) => {
  const queryClient = useQueryClient();
  return useMutation(
    (body: Partial<dataService.AdminPanelBalance>) =>
      dataService.updateAdminPanelBalance(userId, body),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminPanelBalance, userId]);
        queryClient.invalidateQueries([QueryKeys.adminPanelSummary]);
      },
    },
  );
};
