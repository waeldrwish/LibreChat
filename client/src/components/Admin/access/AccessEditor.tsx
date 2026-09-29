import type { AccessPrincipalType } from 'librechat-data-provider';
import { useAdminAccessQuery } from '~/data-provider';
import AgentAccessSection from './AgentAccessSection';
import ModelAccessSection from './ModelAccessSection';
import LimitsSection from './LimitsSection';
import { Cap, useAdmin } from '../context';
import { QueryState } from '../common/ui';

/**
 * Explicit access set on one user, group or role: model grants, shared agents and
 * usage limits. Each section saves on its own because each needs its own capability.
 */
export default function AccessEditor({
  principalType,
  principalId,
  canManageTeamLimits = false,
}: {
  principalType: AccessPrincipalType;
  principalId: string;
  /** A manager may set limits for a member of their team. */
  canManageTeamLimits?: boolean;
}) {
  const { can } = useAdmin();
  const access = useAdminAccessQuery(principalType, principalId);
  return (
    <QueryState query={access}>
      {(data) => (
        <div className="flex flex-col gap-4">
          {can(Cap.READ_MODELS) && (
            <ModelAccessSection
              access={data}
              principalType={principalType}
              canEdit={can(Cap.MANAGE_MODELS)}
            />
          )}
          {can(Cap.READ_AGENTS) && (
            <AgentAccessSection
              access={data}
              principalType={principalType}
              canEdit={can(Cap.MANAGE_AGENTS)}
            />
          )}
          <LimitsSection
            access={data}
            principalType={principalType}
            canEdit={can(Cap.MANAGE_LIMITS) || canManageTeamLimits}
          />
        </div>
      )}
    </QueryState>
  );
}
