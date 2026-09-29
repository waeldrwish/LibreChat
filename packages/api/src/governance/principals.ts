import { PrincipalType } from 'librechat-data-provider';
import type { UsagePrincipalRef } from '@librechat/data-schemas';
import type { ResolvedPrincipal } from '~/types/principal';

/** A user's identity split by precedence level: the user, their groups, their role. */
export type PrincipalSet = {
  userId: string;
  role?: string;
  groupIds: string[];
};

/** Splits `getUserPrincipals` output into the three governance precedence levels. */
export function toPrincipalSet(userId: string, principals: ResolvedPrincipal[]): PrincipalSet {
  const set: PrincipalSet = { userId, groupIds: [] };
  for (const principal of principals) {
    if (principal.principalId == null) {
      continue;
    }
    const id = principal.principalId.toString();
    if (principal.principalType === PrincipalType.GROUP) {
      set.groupIds.push(id);
    } else if (principal.principalType === PrincipalType.ROLE) {
      set.role = id;
    }
  }
  return set;
}

/** The user, group and role references a limit or grant lookup must consider. */
export function toPrincipalRefs(set: PrincipalSet): UsagePrincipalRef[] {
  const refs: UsagePrincipalRef[] = [{ principalType: 'user', principalId: set.userId }];
  for (const groupId of set.groupIds) {
    refs.push({ principalType: 'group', principalId: groupId });
  }
  if (set.role) {
    refs.push({ principalType: 'role', principalId: set.role });
  }
  return refs;
}
