import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods, SystemCapabilities } from '@librechat/data-schemas';
import {
  SystemRoles,
  PrincipalType,
  ResourceType,
  AccessRoleIds,
  PermissionBits,
} from 'librechat-data-provider';
import type { IUser, AllMethods, SystemCapability } from '@librechat/data-schemas';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TModelsConfig } from 'librechat-data-provider';
import type { ServerRequest } from '~/types/http';
import type { AdminHandler } from './trail';
import { createUsageLimitGuard, createGovernanceService } from '~/governance';
import { generateCapabilityCheck } from '~/middleware/capabilities';
import { AccessControlService } from '~/acl/accessControlService';
import { validateAgentModel } from '~/agents/validation';
import { createAdminAccountsHandlers } from './accounts';
import { createAdminAccessHandlers } from './access';
import { createAdminAuditRecorder } from './trail';
import { createAdminScopeResolver } from './scope';
import { createAdminTeamHandlers } from './teams';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const CATALOG: TModelsConfig = {
  openAI: ['gpt-4o', 'gpt-4o-mini'],
  anthropic: ['claude-opus'],
};

let mongoServer: MongoMemoryServer;
let db: AllMethods;
let app: express.Express;
let actor: Partial<IUser> & { id: string; role: string };
let governance: ReturnType<typeof createGovernanceService>;

type TestUser = { id: string; role: string; email: string; name: string };

async function makeUser(email: string, role: string = SystemRoles.USER): Promise<TestUser> {
  const created = (await db.createUser(
    { email, name: email.split('@')[0], provider: 'local', role, emailVerified: true },
    undefined,
    true,
    true,
  )) as Partial<IUser> & { _id: mongoose.Types.ObjectId };
  return { id: created._id.toString(), role, email, name: email.split('@')[0] };
}

const as = (user: TestUser) => {
  actor = { ...user, _id: new mongoose.Types.ObjectId(user.id) } as typeof actor;
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  db = createMethods(mongoose);
  await db.seedDefaultRoles();
  await db.seedSystemGrants();
  await Promise.all(
    [
      SystemCapabilities.ACCESS_ADMIN,
      SystemCapabilities.READ_TEAM,
      SystemCapabilities.MANAGE_TEAM,
    ].map((capability) =>
      db.grantCapability({ principalType: PrincipalType.ROLE, principalId: 'MANAGER', capability }),
    ),
  );

  const { requireCapability, hasCapability, getHeldCapabilities } = generateCapabilityCheck({
    getUserPrincipals: db.getUserPrincipals,
    hasCapabilityForPrincipals: db.hasCapabilityForPrincipals,
    getHeldCapabilities: db.getHeldCapabilities,
  });
  governance = createGovernanceService({
    listModelPolicies: db.listModelPolicies,
    findUsageLimitsForPrincipals: db.findUsageLimitsForPrincipals,
    getUserUsageSnapshot: db.getUserUsageSnapshot,
    getUserPrincipals: db.getUserPrincipals,
  });
  const acl = new AccessControlService(mongoose, db);
  const recordAdminAction = createAdminAuditRecorder(db.recordAuditEntry);
  const resolveScope = createAdminScopeResolver({
    getHeldCapabilities,
    findManagedGroupIds: db.findManagedGroupIds,
    getGroupMemberUserIds: db.getGroupMemberUserIds,
  });
  const getTenantConfig = async () => ({}) as never;

  const accounts = createAdminAccountsHandlers({
    resolveScope,
    hasCapability,
    listAdminUsers: db.listAdminUsers,
    findAdminUserById: db.findAdminUserById,
    listGroupsForUsers: db.listGroupsForUsers,
    getGroupMemberUserIds: db.getGroupMemberUserIds,
    isEmailTaken: async (email, excludeUserId) => {
      const user = await db.findUser({ email }, '_id');
      return user != null && user._id.toString() !== excludeUserId;
    },
    roleExists: async (name) => (await db.getRoleByName(name)) != null,
    groupExists: async (groupId) => (await db.findGroupById(groupId)) != null,
    countUsersByRole: db.countUsersByRole,
    createUser: db.createUser,
    updateUser: db.updateUser,
    addUserToGroup: db.addUserToGroup,
    removeUserFromGroup: db.removeUserFromGroup,
    deleteAllUserSessions: (userId) => db.deleteAllUserSessions(userId),
    hashPassword: async (password) => `hashed:${password}`,
    getTenantConfig,
    recordAdminAction,
  });
  const access = createAdminAccessHandlers({
    governance,
    resolveScope,
    hasCapability,
    principalExists: async (type, id) => {
      if (type === 'user') return (await db.findAdminUserById(id)) != null;
      if (type === 'group') return (await db.findGroupById(id)) != null;
      return true;
    },
    findGovernanceSubject: async (userId) => {
      const user = await db.findAdminUserById(userId);
      return user ? { id: user._id, role: user.role, idOnTheSource: null } : null;
    },
    getTenantConfig,
    loadAvailableModels: async () => CATALOG,
    listModelPolicies: db.listModelPolicies,
    setPrincipalModelGrants: db.setPrincipalModelGrants,
    findUsageLimitsForPrincipals: db.findUsageLimitsForPrincipals,
    setUsageLimits: db.setUsageLimits,
    listUsageLimits: db.listUsageLimits,
    resolvePrincipalNames: async (_type, ids) => new Map(ids.map((id) => [id, id])),
    listPrincipalAgentAccess: db.listPrincipalAgentAccess,
    findAgentRefs: db.findAgentRefs,
    grantAgentViewer: ({ principalType, principalId, resourceId, grantedBy }) =>
      acl.grantPermission({
        principalType: principalType as PrincipalType,
        principalId,
        resourceType: ResourceType.AGENT,
        resourceId,
        accessRoleId: AccessRoleIds.AGENT_VIEWER,
        grantedBy,
      }),
    revokeAgentAccess: ({ principalType, principalId, resourceId }) =>
      db.revokePermission(principalType, principalId, ResourceType.AGENT, resourceId),
    recordAdminAction,
  });
  const teams = createAdminTeamHandlers({
    setGroupManagers: db.setGroupManagers,
    findAdminUserById: db.findAdminUserById,
    recordAdminAction,
  });

  app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: typeof actor }).user = actor;
    next();
  });
  const mount =
    (handler: AdminHandler): RequestHandler =>
    (req, res) =>
      void handler(req as ServerRequest, res);
  const gate =
    (capability: SystemCapability): RequestHandler =>
    (req, res, next) =>
      void requireCapability(capability)(req as ServerRequest, res, next);
  const admin = express.Router();
  admin.use(gate(SystemCapabilities.ACCESS_ADMIN));
  admin.get('/users', mount(accounts.list));
  admin.post('/users', gate(SystemCapabilities.MANAGE_USERS), mount(accounts.create));
  admin.patch('/users/:id/status', mount(accounts.setStatus));
  admin.get('/users/:id/effective-access', mount(access.effective));
  admin.put('/access/:principalType/:principalId', mount(access.updateAccess));
  admin.put('/groups/:id/managers', mount(teams.setManagers));
  app.use('/admin', admin);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('in-app admin panel governance (real database)', () => {
  let superAdmin: TestUser;
  let employee: TestUser;
  let engineeringId: string;

  beforeAll(async () => {
    superAdmin = await makeUser('root@example.com', SystemRoles.ADMIN);
    employee = await makeUser('staff@example.com');
    const group = await db.createGroup({ name: 'الهندسة', source: 'local', memberIds: [] });
    engineeringId = group._id.toString();
  });

  it('rejects an employee calling the admin API', async () => {
    as(employee);
    const list = await request(app).get('/admin/users');
    expect(list.status).toBe(403);
    const create = await request(app)
      .post('/admin/users')
      .send({ name: 'x', email: 'x@example.com', password: 'password123' });
    expect(create.status).toBe(403);
    expect(await db.findUser({ email: 'x@example.com' })).toBeNull();
  });

  it('lets an administrator create a user in a group and records the action', async () => {
    as(superAdmin);
    const response = await request(app)
      .post('/admin/users')
      .send({
        name: 'مهندس',
        email: 'engineer@example.com',
        password: 'password123',
        groupIds: [engineeringId],
      })
      .expect(201);
    expect(response.body.user).toMatchObject({
      email: 'engineer@example.com',
      role: SystemRoles.USER,
      disabled: false,
      groups: [{ id: engineeringId, name: 'الهندسة' }],
    });

    await request(app)
      .post('/admin/users')
      .send({ name: 'dup', email: 'engineer@example.com', password: 'password123' })
      .expect(409);

    const page = await db.listAuditLogPage(undefined, { action: ['user.created'] });
    expect(page.entries.some((entry) => entry.target.name === 'engineer@example.com')).toBe(true);
  });

  it('passes group model permissions to members and hides the model from everyone else', async () => {
    as(superAdmin);
    await db.createModelPolicy({
      endpoint: 'anthropic',
      model: 'claude-opus',
      enabled: true,
      access: 'restricted',
      grants: [],
    });
    await request(app)
      .put(`/admin/access/group/${engineeringId}`)
      .send({ allowedModels: ['anthropic|claude-opus'] })
      .expect(200);

    const engineer = await db.findUser({ email: 'engineer@example.com' });
    const engineerUser = { id: engineer!._id.toString(), role: SystemRoles.USER };
    const engineerModels = await governance.applyModelAccess({
      user: engineerUser,
      modelsConfig: CATALOG,
    });
    expect(engineerModels.anthropic).toEqual(['claude-opus']);

    const staffModels = await governance.applyModelAccess({
      user: { id: employee.id, role: employee.role },
      modelsConfig: CATALOG,
    });
    expect(staffModels.anthropic).toEqual([]);
    expect(staffModels.openAI).toEqual(['gpt-4o', 'gpt-4o-mini']);

    const effective = await request(app)
      .get(`/admin/users/${engineerUser.id}/effective-access`)
      .expect(200);
    expect(effective.body.models).toContainEqual({
      endpoint: 'anthropic',
      model: 'claude-opus',
      allowed: true,
      source: 'group',
    });
  });

  it('lets an agent run a model its users cannot pick when the model is delegated to it', async () => {
    const policies = await db.listModelPolicies();
    const opus = policies.find((policy) => policy.model === 'claude-opus')!;
    await db.updateModelPolicy(opus._id, {
      grants: [
        ...opus.grants,
        { principalType: 'agent', principalId: 'agent_hr', effect: 'allow' },
      ],
    });
    governance.invalidate();

    const staffModels = await governance.applyModelAccess({
      user: { id: employee.id, role: employee.role },
      modelsConfig: CATALOG,
    });
    const logViolation = jest.fn();
    const validate = (agentId: string) =>
      validateAgentModel({
        req: {} as never,
        res: {} as never,
        agent: { id: agentId, provider: 'anthropic', model: 'claude-opus' } as never,
        modelsConfig: staffModels,
        logViolation,
      });
    await expect(validate('agent_hr')).resolves.toEqual({ isValid: true });
    await expect(validate('agent_other')).resolves.toMatchObject({ isValid: false });
    expect(logViolation).toHaveBeenCalledTimes(1);
  });

  it('shares an agent with a group so only its members can view it', async () => {
    as(superAdmin);
    const agent = await db.createAgent({
      id: 'agent_hr_assistant',
      name: 'مساعد الموارد البشرية',
      provider: 'openAI',
      model: 'gpt-4o',
      author: new mongoose.Types.ObjectId(superAdmin.id),
    });
    await request(app)
      .put(`/admin/access/group/${engineeringId}`)
      .send({ agentIds: ['agent_hr_assistant'] })
      .expect(200);

    const engineer = await db.findUser({ email: 'engineer@example.com' });
    const canView = async (userId: string) =>
      db.hasPermission(
        await db.getUserPrincipals({ userId, role: SystemRoles.USER }),
        ResourceType.AGENT,
        agent._id,
        PermissionBits.VIEW,
      );
    await expect(canView(engineer!._id.toString())).resolves.toBe(true);
    await expect(canView(employee.id)).resolves.toBe(false);
  });

  it('enforces a group message limit on the chat route and logs the refusal', async () => {
    as(superAdmin);
    await request(app)
      .put(`/admin/access/group/${engineeringId}`)
      .send({ limits: { messagesPerDay: 1 } })
      .expect(200);
    const engineer = await db.findUser({ email: 'engineer@example.com' });
    const engineerId = engineer!._id.toString();
    await db.saveMessage(
      { userId: engineerId },
      {
        messageId: randomUUID(),
        conversationId: randomUUID(),
        text: 'hello',
        isCreatedByUser: true,
        user: engineerId,
      },
    );

    const onExceeded = jest.fn();
    const chat = express();
    chat.use(express.json());
    chat.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: object }).user = { id: engineerId, role: SystemRoles.USER };
      next();
    });
    chat.post(
      '/chat',
      createUsageLimitGuard({
        governance,
        onExceeded,
        deny: (_req, res, error) => res.status(429).json(error),
      }),
      (_req, res) => {
        res.status(200).json({ ok: true });
      },
    );

    const refused = await request(chat).post('/chat').send({ text: 'again' }).expect(429);
    expect(refused.body).toMatchObject({
      type: 'usage_limit',
      metric: 'messagesPerDay',
      limit: 1,
      used: 1,
    });
    expect(onExceeded).toHaveBeenCalledTimes(1);

    const staffChat = express();
    staffChat.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: object }).user = { id: employee.id, role: SystemRoles.USER };
      next();
    });
    staffChat.post(
      '/chat',
      createUsageLimitGuard({ governance, deny: (_req, res) => res.status(429).end() }),
      (_req, res) => {
        res.status(200).end();
      },
    );
    await request(staffChat).post('/chat').expect(200);
  });

  it('scopes a manager to the members of the groups they manage', async () => {
    const manager = await makeUser('manager@example.com', 'MANAGER');
    as(superAdmin);
    await request(app)
      .put(`/admin/groups/${engineeringId}/managers`)
      .send({ managerIds: [manager.id] })
      .expect(200);

    as(manager);
    const response = await request(app).get('/admin/users').expect(200);
    expect(response.body.users.map((user: { email: string }) => user.email)).toEqual([
      'engineer@example.com',
    ]);

    await request(app)
      .patch(`/admin/users/${employee.id}/status`)
      .send({ disabled: true })
      .expect(403);
  });

  it('disables an account so it is no longer an active principal', async () => {
    as(superAdmin);
    await request(app)
      .patch(`/admin/users/${employee.id}/status`)
      .send({ disabled: true })
      .expect(200);
    const stored = await db.findUser({ _id: employee.id });
    expect(stored?.disabled).toBe(true);
    await expect(db.isAgentTriggerPrincipalActive(employee.id)).resolves.toBe(false);

    await request(app)
      .patch(`/admin/users/${superAdmin.id}/status`)
      .send({ disabled: true })
      .expect(400);

    const page = await db.listAuditLogPage(undefined, { action: ['user.disabled'] });
    expect(page.entries[0]).toMatchObject({
      action: 'user.disabled',
      actor: { id: superAdmin.id },
      target: { id: employee.id },
    });
  });
});
