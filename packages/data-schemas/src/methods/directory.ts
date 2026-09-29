import { PermissionBits, PrincipalType, ResourceType } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type { IUser, IGroup, IAgent, IAclEntry } from '~/types';
import { escapeRegExp } from '~/utils/string';

/** Bits an agent owner holds; anything less is a share. */
const OWNER_PERM_BITS =
  PermissionBits.VIEW | PermissionBits.EDIT | PermissionBits.DELETE | PermissionBits.SHARE;

const ADMIN_USER_FIELDS =
  '_id name username email avatar role provider emailVerified disabled disabledAt idOnTheSource tenantId createdAt updatedAt';
const ADMIN_AGENT_FIELDS =
  '_id id name description provider model author authorName category disabled avatar tools updatedAt';
const MAX_SEARCH_LENGTH = 200;

export type AdminUserRecord = {
  _id: string;
  name?: string;
  username?: string;
  email: string;
  avatar?: string;
  role?: string;
  provider: string;
  emailVerified?: boolean;
  disabled?: boolean;
  disabledAt?: Date;
  idOnTheSource?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type AdminUserFilter = {
  search?: string;
  role?: string;
  status?: 'active' | 'disabled';
  /** Restricts the listing to these user ids (a group filter or a manager's team). */
  userIds?: string[];
  limit: number;
  offset: number;
};

export type AdminAgentRecord = {
  _id: string;
  id: string;
  name?: string;
  description?: string;
  provider?: string;
  model?: string;
  author?: string;
  authorName?: string;
  category?: string;
  disabled?: boolean;
  avatar?: { filepath?: string; source?: string } | null;
  toolCount: number;
  updatedAt?: Date;
};

export type AdminAgentFilter = {
  search?: string;
  status?: 'enabled' | 'disabled';
  limit: number;
  offset: number;
};

export type GroupSummary = { id: string; name: string };

/** An agent reference with the permission bits a principal holds on it. */
export type AgentAccessRecord = { _id: string; id: string; name: string; permBits: number };

type LeanId = { _id: { toString(): string } };

function searchRegex(search?: string): RegExp | null {
  const trimmed = search?.trim().slice(0, MAX_SEARCH_LENGTH);
  return trimmed ? new RegExp(escapeRegExp(trimmed), 'i') : null;
}

/**
 * Read models the admin panel lists — users, group membership and agents —
 * expressed as plain filters so callers never build Mongo queries.
 */
export function createDirectoryMethods(mongoose: typeof import('mongoose')): {
  listAdminUsers: (filter: AdminUserFilter) => Promise<{ users: AdminUserRecord[]; total: number }>;
  findAdminUserById: (userId: string) => Promise<AdminUserRecord | null>;
  countAdminUsers: () => Promise<{ total: number; disabled: number }>;
  resolveMemberUserIds: (memberIds: string[]) => Promise<string[]>;
  getGroupMemberUserIds: (groupIds: string[]) => Promise<string[]>;
  findManagedGroupIds: (managerId: string) => Promise<string[]>;
  setGroupManagers: (groupId: string, managerIds: string[]) => Promise<IGroup | null>;
  listGroupsForUsers: (users: AdminUserRecord[]) => Promise<Map<string, GroupSummary[]>>;
  listAdminAgents: (
    filter: AdminAgentFilter,
  ) => Promise<{ agents: AdminAgentRecord[]; total: number }>;
  findAdminAgent: (agentId: string) => Promise<AdminAgentRecord | null>;
  countAdminAgents: () => Promise<{ total: number; disabled: number }>;
  setAgentDisabled: (agentId: string, disabled: boolean) => Promise<AdminAgentRecord | null>;
  isAgentDisabled: (agentId: string) => Promise<boolean>;
  summarizeAgentSharing: (
    objectIds: string[],
  ) => Promise<Map<string, { sharedWith: number; isPublic: boolean }>>;
  listPrincipalAgentAccess: (
    principalType: 'user' | 'group' | 'role',
    principalId: string,
  ) => Promise<AgentAccessRecord[]>;
  findAgentRefs: (agentIds: string[]) => Promise<AgentAccessRecord[]>;
  findAgentNames: (agentIds: string[]) => Promise<Map<string, string>>;
} {
  const User = () => mongoose.models.User as Model<IUser>;
  const Group = () => mongoose.models.Group as Model<IGroup>;
  const Agent = () => mongoose.models.Agent as Model<IAgent>;
  const toObjectIds = (ids: string[]) =>
    ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));

  const toUserRecord = (doc: AdminUserRecord & LeanId): AdminUserRecord => ({
    ...doc,
    _id: doc._id.toString(),
  });

  const toAgentRecord = (
    doc: Omit<AdminAgentRecord, '_id' | 'toolCount'> & LeanId & { tools?: string[] },
  ): AdminAgentRecord => {
    const { tools, ...rest } = doc;
    return { ...rest, _id: doc._id.toString(), toolCount: tools?.length ?? 0 };
  };

  function buildUserQuery(filter: Omit<AdminUserFilter, 'limit' | 'offset'>) {
    const query: Record<string, unknown> = {};
    const regex = searchRegex(filter.search);
    if (regex) {
      query.$or = [{ name: regex }, { email: regex }, { username: regex }];
    }
    if (filter.role) {
      query.role = filter.role;
    }
    if (filter.status === 'disabled') {
      query.disabled = true;
    } else if (filter.status === 'active') {
      query.disabled = { $ne: true };
    }
    if (filter.userIds) {
      query._id = { $in: toObjectIds(filter.userIds) };
    }
    return query;
  }

  async function listAdminUsers(filter: AdminUserFilter) {
    const query = buildUserQuery(filter);
    const [docs, total] = await Promise.all([
      User()
        .find(query, ADMIN_USER_FIELDS)
        .sort({ createdAt: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .lean<Array<AdminUserRecord & LeanId>>(),
      User().countDocuments(query),
    ]);
    return { users: docs.map(toUserRecord), total };
  }

  async function findAdminUserById(userId: string): Promise<AdminUserRecord | null> {
    if (!mongoose.isValidObjectId(userId)) {
      return null;
    }
    const doc = await User().findById(userId, ADMIN_USER_FIELDS).lean<AdminUserRecord & LeanId>();
    return doc ? toUserRecord(doc) : null;
  }

  async function countAdminUsers() {
    const [total, disabled] = await Promise.all([
      User().countDocuments({}),
      User().countDocuments({ disabled: true }),
    ]);
    return { total, disabled };
  }

  /** Maps group `memberIds` (user ids or external `idOnTheSource` values) to user ids. */
  async function resolveMemberUserIds(memberIds: string[]): Promise<string[]> {
    if (memberIds.length === 0) {
      return [];
    }
    const docs = await User()
      .find(
        { $or: [{ _id: { $in: toObjectIds(memberIds) } }, { idOnTheSource: { $in: memberIds } }] },
        '_id',
      )
      .lean<LeanId[]>();
    return docs.map((doc) => doc._id.toString());
  }

  async function getGroupMemberUserIds(groupIds: string[]): Promise<string[]> {
    const groups = await Group()
      .find({ _id: { $in: toObjectIds(groupIds) } }, 'memberIds')
      .lean<Array<Pick<IGroup, 'memberIds'>>>();
    const memberIds = new Set<string>();
    for (const group of groups) {
      for (const memberId of group.memberIds ?? []) {
        memberIds.add(memberId);
      }
    }
    return resolveMemberUserIds([...memberIds]);
  }

  async function findManagedGroupIds(managerId: string): Promise<string[]> {
    const groups = await Group().find({ managerIds: managerId }, '_id').lean<LeanId[]>();
    return groups.map((group) => group._id.toString());
  }

  async function setGroupManagers(groupId: string, managerIds: string[]) {
    if (!mongoose.isValidObjectId(groupId)) {
      return null;
    }
    return Group()
      .findByIdAndUpdate(groupId, { $set: { managerIds } }, { new: true })
      .lean<IGroup>();
  }

  async function listGroupsForUsers(users: AdminUserRecord[]) {
    const memberKeyToUser = new Map<string, string>();
    for (const user of users) {
      memberKeyToUser.set(user._id, user._id);
      if (user.idOnTheSource) {
        memberKeyToUser.set(user.idOnTheSource, user._id);
      }
    }
    const result = new Map<string, GroupSummary[]>();
    if (memberKeyToUser.size === 0) {
      return result;
    }
    const groups = await Group()
      .find({ memberIds: { $in: [...memberKeyToUser.keys()] } }, '_id name memberIds')
      .lean<Array<Pick<IGroup, 'name' | 'memberIds'> & LeanId>>();
    for (const group of groups) {
      const summary = { id: group._id.toString(), name: group.name };
      const seen = new Set<string>();
      for (const memberId of group.memberIds ?? []) {
        const userId = memberKeyToUser.get(memberId);
        if (!userId || seen.has(userId)) {
          continue;
        }
        seen.add(userId);
        const list = result.get(userId) ?? [];
        list.push(summary);
        result.set(userId, list);
      }
    }
    return result;
  }

  async function listAdminAgents(filter: AdminAgentFilter) {
    const query: Record<string, unknown> = {};
    const regex = searchRegex(filter.search);
    if (regex) {
      query.$or = [{ name: regex }, { description: regex }, { id: regex }];
    }
    if (filter.status === 'disabled') {
      query.disabled = true;
    } else if (filter.status === 'enabled') {
      query.disabled = { $ne: true };
    }
    const [docs, total] = await Promise.all([
      Agent()
        .find(query, ADMIN_AGENT_FIELDS)
        .sort({ updatedAt: -1, _id: 1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .lean<Array<Omit<AdminAgentRecord, '_id' | 'toolCount'> & LeanId & { tools?: string[] }>>(),
      Agent().countDocuments(query),
    ]);
    return { agents: docs.map(toAgentRecord), total };
  }

  async function findAdminAgent(agentId: string) {
    const doc = await Agent()
      .findOne({ id: agentId }, ADMIN_AGENT_FIELDS)
      .lean<Omit<AdminAgentRecord, '_id' | 'toolCount'> & LeanId & { tools?: string[] }>();
    return doc ? toAgentRecord(doc) : null;
  }

  async function countAdminAgents() {
    const [total, disabled] = await Promise.all([
      Agent().countDocuments({}),
      Agent().countDocuments({ disabled: true }),
    ]);
    return { total, disabled };
  }

  /** Flips the disabled flag without creating an agent version: it is an operational state. */
  async function setAgentDisabled(agentId: string, disabled: boolean) {
    const update = disabled ? { $set: { disabled: true } } : { $unset: { disabled: '' } };
    const doc = await Agent()
      .findOneAndUpdate({ id: agentId }, update, {
        new: true,
        timestamps: false,
        projection: ADMIN_AGENT_FIELDS,
      })
      .lean<Omit<AdminAgentRecord, '_id' | 'toolCount'> & LeanId & { tools?: string[] }>();
    return doc ? toAgentRecord(doc) : null;
  }

  async function isAgentDisabled(agentId: string): Promise<boolean> {
    const doc = await Agent().findOne({ id: agentId, disabled: true }, '_id').lean<LeanId>();
    return doc != null;
  }

  /**
   * Per agent: how many principals it is shared with beyond its owners, and
   * whether it is public.
   */
  async function summarizeAgentSharing(objectIds: string[]) {
    const summary = new Map<string, { sharedWith: number; isPublic: boolean }>();
    if (objectIds.length === 0) {
      return summary;
    }
    const AclEntry = mongoose.models.AclEntry as Model<IAclEntry>;
    const rows = await AclEntry.aggregate<{ _id: unknown; sharedWith: number; isPublic: number }>([
      {
        $match: {
          resourceType: ResourceType.AGENT,
          resourceId: { $in: toObjectIds(objectIds) },
        },
      },
      {
        $group: {
          _id: '$resourceId',
          sharedWith: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$principalType', PrincipalType.PUBLIC] },
                    { $lt: ['$permBits', OWNER_PERM_BITS] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          isPublic: {
            $max: { $cond: [{ $eq: ['$principalType', PrincipalType.PUBLIC] }, 1, 0] },
          },
        },
      },
    ]);
    for (const row of rows) {
      summary.set(String(row._id), { sharedWith: row.sharedWith, isPublic: row.isPublic === 1 });
    }
    return summary;
  }

  /** Agents shared directly with one principal, with the bits of that share. */
  async function listPrincipalAgentAccess(
    principalType: 'user' | 'group' | 'role',
    principalId: string,
  ): Promise<AgentAccessRecord[]> {
    const AclEntry = mongoose.models.AclEntry as Model<IAclEntry>;
    const storedId =
      principalType === 'role' ? principalId : (toObjectIds([principalId])[0] ?? principalId);
    const entries = await AclEntry.find(
      { principalType, principalId: storedId, resourceType: ResourceType.AGENT },
      'resourceId permBits',
    ).lean<Array<Pick<IAclEntry, 'resourceId' | 'permBits'>>>();
    if (entries.length === 0) {
      return [];
    }
    const agents = await Agent()
      .find({ _id: { $in: entries.map((entry) => entry.resourceId) } }, '_id id name')
      .lean<Array<Pick<IAgent, 'id' | 'name'> & LeanId>>();
    const bitsById = new Map(entries.map((entry) => [entry.resourceId.toString(), entry.permBits]));
    return agents.map((agent) => ({
      _id: agent._id.toString(),
      id: agent.id,
      name: agent.name ?? agent.id,
      permBits: bitsById.get(agent._id.toString()) ?? 0,
    }));
  }

  async function findAgentRefs(agentIds: string[]): Promise<AgentAccessRecord[]> {
    if (agentIds.length === 0) {
      return [];
    }
    const agents = await Agent()
      .find({ id: { $in: agentIds } }, '_id id name')
      .lean<Array<Pick<IAgent, 'id' | 'name'> & LeanId>>();
    return agents.map((agent) => ({
      _id: agent._id.toString(),
      id: agent.id,
      name: agent.name ?? agent.id,
      permBits: 0,
    }));
  }

  async function findAgentNames(agentIds: string[]) {
    if (agentIds.length === 0) {
      return new Map<string, string>();
    }
    const docs = await Agent()
      .find({ id: { $in: agentIds } }, 'id name')
      .lean<Array<Pick<IAgent, 'id' | 'name'>>>();
    return new Map(docs.map((doc) => [doc.id, doc.name ?? doc.id]));
  }

  return {
    listAdminUsers,
    findAdminUserById,
    countAdminUsers,
    resolveMemberUserIds,
    getGroupMemberUserIds,
    findManagedGroupIds,
    setGroupManagers,
    listGroupsForUsers,
    listAdminAgents,
    findAdminAgent,
    countAdminAgents,
    setAgentDisabled,
    isAgentDisabled,
    summarizeAgentSharing,
    listPrincipalAgentAccess,
    findAgentRefs,
    findAgentNames,
  };
}

export type DirectoryMethods = ReturnType<typeof createDirectoryMethods>;
