import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import type { AgentUpdateParams } from 'librechat-data-provider';
import { useUpdateAgentMutation } from '~/data-provider';
import { useAdminNotify } from '../../common/ui';
import { useLocalize } from '~/hooks';

/** Saves part of an agent through the agents API and refreshes what the panel shows of it. */
export function useAgentSave(agentId: string): {
  save: (data: AgentUpdateParams) => void;
  isSaving: boolean;
} {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const queryClient = useQueryClient();
  const mutation = useUpdateAgentMutation();

  const save = (data: AgentUpdateParams) =>
    mutation.mutate(
      { agent_id: agentId, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries([QueryKeys.agent, agentId, 'expanded']);
          queryClient.invalidateQueries([QueryKeys.adminAgents]);
          notify.success(localize('com_admin_saved'));
        },
        onError: notify.error,
      },
    );

  return { save, isSaving: mutation.isLoading };
}
