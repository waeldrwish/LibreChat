import { z } from 'zod';
import { SystemRoles } from 'librechat-data-provider';
import { logger, SystemCapabilities, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  IUser,
  AppConfig,
  BalanceConfig,
  CreateUserRequest,
  GroupSummary,
  AdminUserRecord,
  DirectoryMethods,
  SystemCapability,
} from '@librechat/data-schemas';
import type { TAdminUser, TAdminUsersPage, TAdminUserStatus } from 'librechat-data-provider';
import type { Response } from 'express';
import type { AdminAuditRecorder, AdminHandler, AdminActor } from './trail';
import type { AdminScopeResolver, CapabilityUser } from './scope';
import type { ServerRequest } from '~/types/http';
import { scopeIncludes, scopeUserIds, toCapabilityUser } from './scope';
import { parsePagination } from './pagination';
import { resolveAdminActor } from './trail';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_GROUPS = 100;

const passwordSchema = z.string().min(8).max(128);
const groupIdsSchema = z
  .array(z.string().refine(isValidObjectIdString, { message: 'Invalid group id' }))
  .max(MAX_GROUPS);

const createSchema = z.object({
  name: z.string().trim().min(1).max(128),
  email: z.string().trim().toLowerCase().max(254).regex(EMAIL),
  username: z.string().trim().max(80).optional(),
  password: passwordSchema,
  role: z.string().trim().min(1).max(64).optional(),
  groupIds: groupIdsSchema.optional(),
  disabled: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  email: z.string().trim().toLowerCase().max(254).regex(EMAIL).optional(),
  username: z.string().trim().max(80).optional(),
  role: z.string().trim().min(1).max(64).optional(),
  groupIds: groupIdsSchema.optional(),
});

type CreatedUser = Partial<IUser> & { _id?: { toString(): string } };

export interface AdminAccountsDeps {
  resolveScope: AdminScopeResolver;
  hasCapability: (user: CapabilityUser, capability: SystemCapability) => Promise<boolean>;
  listAdminUsers: DirectoryMethods['listAdminUsers'];
  findAdminUserById: DirectoryMethods['findAdminUserById'];
  listGroupsForUsers: DirectoryMethods['listGroupsForUsers'];
  getGroupMemberUserIds: DirectoryMethods['getGroupMemberUserIds'];
  isEmailTaken: (email: string, excludeUserId?: string) => Promise<boolean>;
  roleExists: (name: string) => Promise<boolean>;
  groupExists: (groupId: string) => Promise<boolean>;
  countUsersByRole: (role: string) => Promise<number>;
  createUser: (
    data: CreateUserRequest,
    balanceConfig?: BalanceConfig,
    disableTTL?: boolean,
    returnUser?: boolean,
  ) => Promise<unknown>;
  updateUser: (userId: string, data: Partial<IUser>) => Promise<IUser | null>;
  addUserToGroup: (userId: string, groupId: string) => Promise<unknown>;
  removeUserFromGroup: (userId: string, groupId: string) => Promise<unknown>;
  deleteAllUserSessions: (userId: string) => Promise<unknown>;
  hashPassword: (password: string) => Promise<string>;
  getTenantConfig: (tenantId?: string) => Promise<AppConfig>;
  recordAdminAction: AdminAuditRecorder;
}

function toAdminUser(user: AdminUserRecord, groups: GroupSummary[] = []): TAdminUser {
  return {
    id: user._id,
    name: user.name ?? '',
    username: user.username ?? '',
    email: user.email,
    avatar: user.avatar ?? '',
    role: user.role ?? SystemRoles.USER,
    provider: user.provider ?? 'local',
    emailVerified: user.emailVerified,
    disabled: user.disabled === true,
    disabledAt: user.disabledAt?.toISOString(),
    createdAt: user.createdAt?.toISOString(),
    updatedAt: user.updatedAt?.toISOString(),
    groups,
  };
}

const firstError = (error: z.ZodError) => {
  const issue = error.errors[0];
  return issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request';
};

/** Account administration: listing, creating, editing, enabling/disabling and password resets. */
export function createAdminAccountsHandlers(
  deps: AdminAccountsDeps,
): Record<'list' | 'get' | 'create' | 'update' | 'setStatus' | 'resetPassword', AdminHandler> {
  const can = (actor: AdminActor, capability: SystemCapability) =>
    deps.hasCapability(toCapabilityUser(actor), capability);

  async function withGroups(users: AdminUserRecord[]): Promise<TAdminUser[]> {
    const groups = await deps.listGroupsForUsers(users);
    return users.map((user) => toAdminUser(user, groups.get(user._id)));
  }

  /** Last-admin guard: an administrator role change must leave at least one admin. */
  async function wouldRemoveLastAdmin(user: AdminUserRecord, nextRole?: string) {
    if (user.role !== SystemRoles.ADMIN || nextRole === SystemRoles.ADMIN) {
      return false;
    }
    return (await deps.countUsersByRole(SystemRoles.ADMIN)) <= 1;
  }

  async function syncGroups(userId: string, current: GroupSummary[], groupIds: string[]) {
    const currentIds = new Set(current.map((group) => group.id));
    const wanted = new Set(groupIds);
    await Promise.all([
      ...groupIds
        .filter((groupId) => !currentIds.has(groupId))
        .map((groupId) => deps.addUserToGroup(userId, groupId)),
      ...[...currentIds]
        .filter((groupId) => !wanted.has(groupId))
        .map((groupId) => deps.removeUserFromGroup(userId, groupId)),
    ]);
  }

  async function validateGroups(groupIds: string[] | undefined): Promise<boolean> {
    if (!groupIds?.length) {
      return true;
    }
    const exists = await Promise.all(groupIds.map((groupId) => deps.groupExists(groupId)));
    return exists.every(Boolean);
  }

  async function list(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const scope = await deps.resolveScope(actor, SystemCapabilities.READ_USERS);
      if (scope.kind === 'none') {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const { limit, offset } = parsePagination(req.query as { limit?: string; offset?: string });
      const query = req.query as Record<string, string | undefined>;
      let userIds = scopeUserIds(scope);
      if (query.groupId) {
        if (!isValidObjectIdString(query.groupId)) {
          return res.status(400).json({ error: 'Invalid group id' });
        }
        const members = await deps.getGroupMemberUserIds([query.groupId]);
        userIds = userIds ? members.filter((id) => userIds?.includes(id)) : members;
      }
      const status: TAdminUserStatus | undefined =
        query.status === 'active' || query.status === 'disabled' ? query.status : undefined;
      const { users, total } = await deps.listAdminUsers({
        search: query.search,
        role: query.role,
        status,
        userIds,
        limit,
        offset,
      });
      const body: TAdminUsersPage = { users: await withGroups(users), total, limit, offset };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminAccounts] list error:', error);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  async function get(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { id } = req.params as { id: string };
      const scope = await deps.resolveScope(actor, SystemCapabilities.READ_USERS);
      if (!scopeIncludes(scope, id)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const user = await deps.findAdminUserById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const [withGroup] = await withGroups([user]);
      return res.status(200).json({ user: withGroup });
    } catch (error) {
      logger.error('[adminAccounts] get error:', error);
      return res.status(500).json({ error: 'Failed to load user' });
    }
  }

  async function create(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: firstError(parsed.error) });
      }
      const body = parsed.data;
      const role = body.role ?? SystemRoles.USER;
      if (role !== SystemRoles.USER && !(await can(actor, SystemCapabilities.MANAGE_ROLES))) {
        return res.status(403).json({ error: 'Assigning a role requires manage:roles' });
      }
      if (body.groupIds?.length && !(await can(actor, SystemCapabilities.MANAGE_GROUPS))) {
        return res.status(403).json({ error: 'Assigning groups requires manage:groups' });
      }
      if (role !== SystemRoles.USER && !(await deps.roleExists(role))) {
        return res.status(400).json({ error: 'Role not found' });
      }
      if (!(await validateGroups(body.groupIds))) {
        return res.status(400).json({ error: 'Group not found' });
      }
      if (await deps.isEmailTaken(body.email)) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }

      const appConfig = await deps.getTenantConfig(actor.tenantId);
      const created = (await deps.createUser(
        {
          provider: 'local',
          email: body.email,
          name: body.name,
          username: body.username ?? '',
          role,
          emailVerified: true,
          password: await deps.hashPassword(body.password),
          ...(body.disabled ? { disabled: true, disabledAt: new Date() } : {}),
        },
        appConfig?.balance,
        true,
        true,
      )) as CreatedUser;
      const userId = created._id?.toString() ?? '';
      if (body.groupIds?.length) {
        await syncGroups(userId, [], body.groupIds);
      }

      await deps.recordAdminAction(req, {
        action: 'user.created',
        target: { type: 'user', id: userId, name: body.email },
        metadata: {
          role,
          groups: body.groupIds?.length ?? 0,
          disabled: body.disabled === true,
        },
      });
      const record = await deps.findAdminUserById(userId);
      const [user] = record ? await withGroups([record]) : [];
      return res.status(201).json({ user });
    } catch (error) {
      logger.error('[adminAccounts] create error:', error);
      return res.status(500).json({ error: 'Failed to create user' });
    }
  }

  async function update(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { id } = req.params as { id: string };
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: firstError(parsed.error) });
      }
      const body = parsed.data;
      const user = await deps.findAdminUserById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const roleChanges = body.role !== undefined && body.role !== user.role;
      const [canEdit, canRoles, canGroups] = await Promise.all([
        can(actor, SystemCapabilities.MANAGE_USERS),
        roleChanges ? can(actor, SystemCapabilities.MANAGE_ROLES) : Promise.resolve(true),
        body.groupIds ? can(actor, SystemCapabilities.MANAGE_GROUPS) : Promise.resolve(true),
      ]);
      if (!canEdit || !canRoles || !canGroups) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      if (roleChanges) {
        if (body.role !== SystemRoles.USER && !(await deps.roleExists(body.role as string))) {
          return res.status(400).json({ error: 'Role not found' });
        }
        if (await wouldRemoveLastAdmin(user, body.role)) {
          return res.status(400).json({ error: 'Cannot remove the last admin user' });
        }
      }
      if (body.email && body.email !== user.email && (await deps.isEmailTaken(body.email, id))) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      if (!(await validateGroups(body.groupIds))) {
        return res.status(400).json({ error: 'Group not found' });
      }

      const changes: Partial<IUser> = {};
      if (body.name !== undefined) changes.name = body.name;
      if (body.username !== undefined) changes.username = body.username;
      if (body.email !== undefined) changes.email = body.email;
      if (roleChanges) changes.role = body.role;
      if (Object.keys(changes).length > 0) {
        await deps.updateUser(id, changes);
      }
      if (body.groupIds) {
        const [current] = await withGroups([user]);
        await syncGroups(id, current.groups, body.groupIds);
      }

      await deps.recordAdminAction(req, {
        action: 'user.updated',
        severity: roleChanges ? 'warning' : 'info',
        target: { type: 'user', id, name: user.email },
        metadata: {
          fields: Object.keys(body).sort().join(','),
          ...(roleChanges ? { fromRole: user.role ?? null, toRole: body.role ?? null } : {}),
        },
      });
      const record = await deps.findAdminUserById(id);
      const [updated] = record ? await withGroups([record]) : [];
      return res.status(200).json({ user: updated });
    } catch (error) {
      logger.error('[adminAccounts] update error:', error);
      return res.status(500).json({ error: 'Failed to update user' });
    }
  }

  /** Disables or re-enables an account; managers may do so for their team members. */
  async function setStatus(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { id } = req.params as { id: string };
      const disabled = (req.body as { disabled?: unknown })?.disabled;
      if (typeof disabled !== 'boolean') {
        return res.status(400).json({ error: 'disabled must be a boolean' });
      }
      if (id === actor.userId) {
        return res.status(400).json({ error: 'You cannot change the status of your own account' });
      }
      const scope = await deps.resolveScope(actor, SystemCapabilities.MANAGE_USERS);
      const allowed =
        scope.kind === 'global' ||
        (scope.kind === 'team' && scope.canManage && scope.userIds.includes(id));
      if (!allowed) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const user = await deps.findAdminUserById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (scope.kind === 'team' && user.role === SystemRoles.ADMIN) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      if (disabled && (await wouldRemoveLastAdmin(user))) {
        return res.status(400).json({ error: 'Cannot disable the last admin user' });
      }

      await deps.updateUser(
        id,
        disabled ? { disabled: true, disabledAt: new Date() } : { disabled: false },
      );
      if (disabled) {
        await deps.deleteAllUserSessions(id);
      }
      await deps.recordAdminAction(req, {
        action: disabled ? 'user.disabled' : 'user.enabled',
        severity: 'warning',
        target: { type: 'user', id, name: user.email },
      });
      const record = await deps.findAdminUserById(id);
      const [updated] = record ? await withGroups([record]) : [];
      return res.status(200).json({ user: updated });
    } catch (error) {
      logger.error('[adminAccounts] setStatus error:', error);
      return res.status(500).json({ error: 'Failed to update user status' });
    }
  }

  /** Sets a new password for a local account and signs it out everywhere. */
  async function resetPassword(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { id } = req.params as { id: string };
      const parsed = passwordSchema.safeParse((req.body as { password?: unknown })?.password);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Password must be 8-128 characters' });
      }
      const user = await deps.findAdminUserById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (user.provider !== 'local') {
        return res
          .status(400)
          .json({ error: 'Passwords can only be reset for accounts that sign in with email' });
      }
      await deps.updateUser(id, { password: await deps.hashPassword(parsed.data) });
      await deps.deleteAllUserSessions(id);
      await deps.recordAdminAction(req, {
        action: 'user.password_reset',
        severity: 'warning',
        target: { type: 'user', id, name: user.email },
      });
      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[adminAccounts] resetPassword error:', error);
      return res.status(500).json({ error: 'Failed to reset password' });
    }
  }

  return { list, get, create, update, setStatus, resetPassword };
}
