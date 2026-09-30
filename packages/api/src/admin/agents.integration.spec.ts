import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SystemRoles, Permissions, PermissionTypes } from 'librechat-data-provider';
import { createModels, createMethods, SystemCapabilities } from '@librechat/data-schemas';
import type { IUser, AllMethods, SystemCapability } from '@librechat/data-schemas';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TAdminAgentPolicy } from 'librechat-data-provider';
import type { ServerRequest } from '~/types/http';
import type { AdminHandler } from './trail';
import { generateCapabilityCheck } from '~/middleware/capabilities';
import { createAdminAgentPolicyHandlers } from './agents';
import { generateCheckAccess } from '~/middleware/access';
import { createAdminAuditRecorder } from './trail';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

let mongoServer: MongoMemoryServer;
let db: AllMethods;
let app: express.Express;
let actor: Partial<IUser> & { id: string; role: string };

type TestUser = { id: string; role: string };

async function makeUser(email: string, role: string): Promise<TestUser> {
  const created = (await db.createUser(
    { email, name: email.split('@')[0], provider: 'local', role, emailVerified: true },
    undefined,
    true,
    true,
  )) as Partial<IUser> & { _id: mongoose.Types.ObjectId };
  return { id: created._id.toString(), role };
}

const as = (user: TestUser) => {
  actor = { ...user, _id: new mongoose.Types.ObjectId(user.id) } as typeof actor;
};

const agentPermissions = async (name: string) =>
  ((await db.getRoleByName(name))?.permissions as Record<string, Record<string, boolean>>)[
    PermissionTypes.AGENTS
  ];

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  db = createMethods(mongoose);
  await db.seedDefaultRoles();
  await db.seedSystemGrants();

  const { requireCapability, hasCapability } = generateCapabilityCheck({
    getUserPrincipals: db.getUserPrincipals,
    hasCapabilityForPrincipals: db.hasCapabilityForPrincipals,
    getHeldCapabilities: db.getHeldCapabilities,
  });
  const policy = createAdminAgentPolicyHandlers({
    listRoles: db.listRoles,
    getRoleByName: db.getRoleByName,
    updateAccessPermissions: db.updateAccessPermissions,
    hasCapability,
    recordAdminAction: createAdminAuditRecorder(db.recordAuditEntry),
  });
  /** The same gate the agents API puts in front of create, edit and delete. */
  const checkAgentCreate = generateCheckAccess({
    permissionType: PermissionTypes.AGENTS,
    permissions: [Permissions.USE, Permissions.CREATE],
    getRoleByName: db.getRoleByName,
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
  admin.get('/agents/policy', gate(SystemCapabilities.READ_AGENTS), mount(policy.get));
  admin.put(
    '/agents/policy',
    gate(SystemCapabilities.MANAGE_AGENTS),
    gate(SystemCapabilities.MANAGE_ROLES),
    mount(policy.update),
  );
  app.use('/admin', admin);
  const created: RequestHandler = (_req, res) => {
    res.status(201).json({ created: true });
  };
  const guard: RequestHandler = (req, res, next) => void checkAgentCreate(req, res, next);
  app.post('/agents', guard, created);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('admin-only agent management (real database)', () => {
  let superAdmin: TestUser;
  let employee: TestUser;

  beforeAll(async () => {
    superAdmin = await makeUser('root@example.com', SystemRoles.ADMIN);
    employee = await makeUser('staff@example.com', SystemRoles.USER);
    await db.createRoleByName({
      name: 'AUDITORS',
      description: 'Staff who may build and share agents',
      permissions: {
        [PermissionTypes.AGENTS]: {
          [Permissions.USE]: true,
          [Permissions.CREATE]: true,
          [Permissions.SHARE]: true,
        },
      },
    });
  });

  it('keeps employees out', async () => {
    as(employee);
    const responses = await Promise.all([
      request(app).get('/admin/agents/policy'),
      request(app).put('/admin/agents/policy').send({ adminOnly: false }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403]);
  });

  it('reports that every role may build agents by default', async () => {
    as(superAdmin);
    const { body } = (await request(app).get('/admin/agents/policy').expect(200)) as {
      body: TAdminAgentPolicy;
    };
    expect(body.adminOnly).toBe(false);
    expect(body.canManage).toBe(true);
    expect(body.roles.map((role) => role.name)).toEqual(
      expect.arrayContaining([SystemRoles.ADMIN, SystemRoles.USER, 'AUDITORS']),
    );
    as(employee);
    await request(app).post('/agents').expect(201);
  });

  it('withdraws building and sharing from every role but ADMIN, which the agents API enforces', async () => {
    as(superAdmin);
    const { body } = (await request(app)
      .put('/admin/agents/policy')
      .send({ adminOnly: true })
      .expect(200)) as { body: TAdminAgentPolicy };
    expect(body.adminOnly).toBe(true);

    for (const name of [SystemRoles.USER, 'AUDITORS']) {
      expect(await agentPermissions(name)).toMatchObject({
        [Permissions.USE]: true,
        [Permissions.CREATE]: false,
        [Permissions.SHARE]: false,
        [Permissions.SHARE_PUBLIC]: false,
      });
    }
    expect(await agentPermissions(SystemRoles.ADMIN)).toMatchObject({
      [Permissions.CREATE]: true,
      [Permissions.SHARE]: true,
    });

    as(employee);
    await request(app).post('/agents').expect(403);
    as(superAdmin);
    await request(app).post('/agents').expect(201);

    const audit = await db.listAuditLogPage(undefined, { action: ['role.permissions_updated'] });
    expect(audit.entries.map((entry) => entry.target?.id)).toEqual(
      expect.arrayContaining([SystemRoles.USER, 'AUDITORS']),
    );
  });

  it('gives building back to every role when switched off', async () => {
    as(superAdmin);
    const { body } = (await request(app)
      .put('/admin/agents/policy')
      .send({ adminOnly: false })
      .expect(200)) as { body: TAdminAgentPolicy };
    expect(body.adminOnly).toBe(false);
    expect(await agentPermissions(SystemRoles.USER)).toMatchObject({
      [Permissions.CREATE]: true,
      [Permissions.SHARE]: true,
    });
    as(employee);
    await request(app).post('/agents').expect(201);
  });

  it('refuses a body without a boolean', async () => {
    as(superAdmin);
    const response = await request(app).put('/admin/agents/policy').send({ adminOnly: 'yes' });
    expect(response.status).toBe(400);
  });
});
