import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@librechat/client';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useDeleteAgentMutation } from '~/data-provider';
import { ConfirmDialog } from '../common/controls';
import { useAdminNotify } from '../common/ui';
import { useLocalize } from '~/hooks';

/** Deletes an agent for everyone it was handed out to, after a confirmation. */
export default function DeleteAgent({
  id,
  name,
  compact = false,
  onDeleted,
}: {
  id: string;
  name: string;
  /** An icon button for table rows instead of a labelled one. */
  compact?: boolean;
  onDeleted?: () => void;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const mutation = useDeleteAgentMutation({
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminAgents]);
      queryClient.invalidateQueries([QueryKeys.adminOverview]);
      notify.success(localize('com_admin_agent_deleted', { 0: name }));
      setOpen(false);
      onDeleted?.();
    },
    onError: notify.error,
  });
  const label = localize('com_admin_agent_delete_named', { 0: name });

  return (
    <>
      {compact ? (
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={() => setOpen(true)}>
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      ) : (
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" aria-hidden="true" />
          {localize('com_admin_agent_delete')}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive={true}
        title={localize('com_admin_agent_delete_title')}
        description={localize('com_admin_agent_delete_confirm', { 0: name })}
        confirmLabel={localize('com_admin_agent_delete')}
        isLoading={mutation.isLoading}
        onConfirm={() => mutation.mutate({ agent_id: id })}
      />
    </>
  );
}
