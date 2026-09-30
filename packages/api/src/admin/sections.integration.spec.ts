import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods, SystemCapabilities } from '@librechat/data-schemas';
import { SystemRoles, PrincipalType, PermissionTypes, Permissions } from 'librechat-data-provider';
import type { IUser, AllMethods, AppConfig, SystemCapability } from '@librechat/data-schemas';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TAdminSections } from 'librechat-data-provider';
import type { ServerRequest } from '~/types/http';
import type { AdminHandler } from './trail';
import { generateCapabilityCheck } from '~/middleware/capabilities';
import { createAdminSectionsHandlers } from './sections';
import { createAdminAuditRecorder } from './trail';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

let mongoServer: MongoMemoryServer;
let db: AllMethods;
let app: express.Express;
let actor: Partial<IUser> & { id: string; role: string };
/** What librechat.yaml would switch off for everyone. */
let baseInterface: Record<string, unknown> = {};

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

const userOverride = async () =>
  (await db.findConfigByPrincipal(PrincipalType.ROLE, SystemRoles.USER, { includeInactive: true }))
    ?.overrides as { interface?: Record<string, unknown> } | undefined;

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
  const sections = createAdminSectionsHandlers({
    listRoles: db.listRoles,
    getRoleByName: db.getRoleByName,
    updateAccessPermissions: db.updateAccessPermissions,
    getTenantConfig: async () => ({ interfaceConfig: baseInterface }) as unknown as AppConfig,
    findConfigByPrincipal: db.findConfigByPrincipal,
    upsertConfig: db.upsertConfig,
    hasCapability,
    recordAdminAction: createAdminAuditRecorder(db.recordAuditEntry),
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
  admin.get('/sections', gate(SystemCapabilities.READ_ROLES), mount(sections.list));
  admin.patch('/sections/:role', gate(SystemCapabilities.MANAGE_ROLES), mount(sections.update));
  app.use('/admin', admin);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('chat sections per role (real database)', () => {
  let superAdmin: TestUser;
  let employee: TestUser;

  beforeAll(async () => {
    superAdmin = await makeUser('root@example.com', SystemRoles.ADMIN);
    employee = await makeUser('staff@example.com', SystemRoles.USER);
  });

  beforeEach(() => {
    baseInterface = {};
  });

  it('keeps employees out', async () => {
    as(employee);
    const responses = await Promise.all([
      request(app).get('/admin/sections'),
      request(app).patch('/admin/sections/USER').send({ section: 'bookmarks', visible: false }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403]);
  });

  it('lists every role with what it sees', async () => {
    as(superAdmin);
    const { body } = (await request(app).get('/admin/sections').expect(200)) as {
      body: TAdminSections;
    };
    expect(body.canManage).toBe(true);
    const user = body.roles.find((role) => role.name === SystemRoles.USER);
    expect(user?.visible).toMatchObject({ bookmarks: true, presets: true, modelSelect: true });
    expect(body.globallyOff).toEqual([]);
  });

  it('hides a permission-backed section through the role permission', async () => {
    as(superAdmin);
    const response = await request(app)
      .patch('/admin/sections/USER')
      .send({ section: 'bookmarks', visible: false })
      .expect(200);
    expect(response.body.role.visible.bookmarks).toBe(false);
    const role = await db.getRoleByName(SystemRoles.USER);
    expect(
      (role?.permissions as Record<string, Record<string, boolean>>)[PermissionTypes.BOOKMARKS][
        Permissions.USE
      ],
    ).toBe(false);
    expect((await userOverride())?.interface?.bookmarks).toBeUndefined();

    await request(app)
      .patch('/admin/sections/USER')
      .send({ section: 'bookmarks', visible: true })
      .expect(200);
  });

  it('hides an interface-only section through the role override, and drops it again', async () => {
    as(superAdmin);
    await request(app)
      .patch('/admin/sections/USER')
      .send({ section: 'presets', visible: false })
      .expect(200);
    expect((await userOverride())?.interface).toEqual({ presets: false });

    const shown = await request(app)
      .patch('/admin/sections/USER')
      .send({ section: 'presets', visible: true })
      .expect(200);
    expect(shown.body.role.visible.presets).toBe(true);
    expect((await userOverride())?.interface).toEqual({});

    const admin = (await request(app).get('/admin/sections')).body as TAdminSections;
    expect(admin.roles.find((role) => role.name === SystemRoles.ADMIN)?.visible.presets).toBe(true);
  });

  it('pins a section on when the deployment hides it, and reports what is off for everyone', async () => {
    as(superAdmin);
    baseInterface = { parameters: false, webSearch: false };
    await request(app)
      .patch('/admin/sections/USER')
      .send({ section: 'parameters', visible: true })
      .expect(200);
    expect((await userOverride())?.interface).toEqual({ parameters: true });

    const { body } = (await request(app).get('/admin/sections')) as { body: TAdminSections };
    expect(body.globallyOff).toEqual(expect.arrayContaining(['parameters', 'webSearch']));
  });

  it('refuses unknown sections and roles', async () => {
    as(superAdmin);
    const responses = await Promise.all([
      request(app).patch('/admin/sections/USER').send({ section: 'nope', visible: false }),
      request(app).patch('/admin/sections/NOPE').send({ section: 'presets', visible: false }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([400, 404]);
  });
});
