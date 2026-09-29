import { SystemCapabilities } from '@librechat/data-schemas';
import type { SystemCapability } from '@librechat/data-schemas';
import type { CapabilityUser } from '~/middleware/capabilities';
import type { AdminActor } from './trail';

export type { CapabilityUser };

/** `global`: everyone; `team`: members of the groups the actor manages; `none`: no access. */
export type AdminScope =
  | { kind: 'global' }
  | { kind: 'team'; userIds: string[]; canManage: boolean }
  | { kind: 'none' };

export interface AdminScopeDeps {
  getHeldCapabilities: (
    user: CapabilityUser,
    capabilities: SystemCapability[],
  ) => Promise<Set<SystemCapability>>;
  findManagedGroupIds: (managerId: string) => Promise<string[]>;
  getGroupMemberUserIds: (groupIds: string[]) => Promise<string[]>;
}

export const toCapabilityUser = (actor: AdminActor): CapabilityUser => ({
  id: actor.userId,
  role: actor.role,
  tenantId: actor.tenantId,
  idOnTheSource: actor.idOnTheSource,
});

/**
 * Resolves which users an administrator may see for a feature: holders of the
 * global capability see everyone; holders of `read:team` see the members of
 * the groups they manage (never themselves unless they are a member).
 */
export type AdminScopeResolver = (
  actor: AdminActor,
  globalCapability: SystemCapability,
) => Promise<AdminScope>;

export function createAdminScopeResolver(deps: AdminScopeDeps): AdminScopeResolver {
  async function teamUserIds(actor: AdminActor): Promise<string[]> {
    const groupIds = await deps.findManagedGroupIds(actor.userId);
    if (groupIds.length === 0) {
      return [];
    }
    return deps.getGroupMemberUserIds(groupIds);
  }

  return async function resolveScope(
    actor: AdminActor,
    globalCapability: SystemCapability,
  ): Promise<AdminScope> {
    const held = await deps.getHeldCapabilities(toCapabilityUser(actor), [
      globalCapability,
      SystemCapabilities.READ_TEAM,
      SystemCapabilities.MANAGE_TEAM,
    ]);
    if (held.has(globalCapability)) {
      return { kind: 'global' };
    }
    const canManage = held.has(SystemCapabilities.MANAGE_TEAM);
    if (canManage || held.has(SystemCapabilities.READ_TEAM)) {
      return { kind: 'team', userIds: await teamUserIds(actor), canManage };
    }
    return { kind: 'none' };
  };
}

/** The user ids a scope restricts a query to; `undefined` means unrestricted. */
export const scopeUserIds = (scope: AdminScope): string[] | undefined =>
  scope.kind === 'team' ? scope.userIds : undefined;

export const scopeIncludes = (scope: AdminScope, userId: string): boolean =>
  scope.kind === 'global' || (scope.kind === 'team' && scope.userIds.includes(userId));
