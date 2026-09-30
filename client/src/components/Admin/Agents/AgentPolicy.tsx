import { Switch } from '@librechat/client';
import { SystemRoles } from 'librechat-data-provider';
import { useAdminAgentPolicyQuery, useUpdateAdminAgentPolicyMutation } from '~/data-provider';
import { Panel, useAdminNotify } from '../common/ui';
import { useAdminFormat } from '../common/format';
import { useLocalize } from '~/hooks';

/**
 * The switch that makes the admin panel the only place agents are built and handed out:
 * it withdraws the agent create/share permissions from every role but ADMIN.
 */
export default function AgentPolicy() {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const format = useAdminFormat();
  const policy = useAdminAgentPolicyQuery();
  const mutation = useUpdateAdminAgentPolicyMutation();

  if (!policy.data) {
    return null;
  }
  const { adminOnly, roles, canManage } = policy.data;
  const builders = roles
    .filter((role) => role.name !== SystemRoles.ADMIN && (role.create || role.share))
    .map((role) => role.name);

  return (
    <Panel className="mb-4">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-text-primary">
            {localize('com_admin_agent_policy_admin_only')}
          </span>
          <span className="block text-xs text-text-secondary">
            {localize('com_admin_agent_policy_hint')}
          </span>
          {!adminOnly && builders.length > 0 && (
            <span className="mt-1 block text-xs text-text-secondary">
              {localize('com_admin_agent_policy_builders', { 0: format.list(builders) })}
            </span>
          )}
        </span>
        <Switch
          aria-label={localize('com_admin_agent_policy_admin_only')}
          checked={adminOnly}
          disabled={!canManage || mutation.isLoading}
          onCheckedChange={(checked) =>
            mutation.mutate(checked, {
              onSuccess: () =>
                notify.success(
                  localize(checked ? 'com_admin_agent_policy_on' : 'com_admin_agent_policy_off'),
                ),
              onError: notify.error,
            })
          }
        />
      </div>
    </Panel>
  );
}
