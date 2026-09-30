import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuthType, SystemRoles, PrincipalType, ResourceType } from 'librechat-data-provider';
import {
  createModels,
  createMethods,
  SystemCapabilities,
  BASE_CONFIG_PRINCIPAL_ID,
} from '@librechat/data-schemas';
import type { IUser, AllMethods, AppConfig, SystemCapability } from '@librechat/data-schemas';
import type { TPlugin, TAdminTools, TAdminMCPServersPage } from 'librechat-data-provider';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminHandler } from './trail';
import { SYSTEM_TOOL_CREDENTIALS_OWNER, withSystemToolCredentials } from '~/tools/credentials';
import { generateCapabilityCheck } from '~/middleware/capabilities';
import { createAdminToolsHandlers } from './tools';
import { createAdminAuditRecorder } from './trail';
import { createAdminMCPHandlers } from './mcp';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const TOOLS: TPlugin[] = [
  {
    name: 'Tavily Search',
    pluginKey: 'tavily_search_results_json',
    authConfig: [{ authField: 'TAVILY_API_KEY', label: 'Tavily API Key', description: '' }],
  },
  {
    name: 'DALL-E-3',
    pluginKey: 'dalle',
    authConfig: [{ authField: 'DALLE3_API_KEY||DALLE_API_KEY', label: 'Key', description: '' }],
  },
];

const ENV: Record<string, string | undefined> = { TAVILY_API_KEY: AuthType.USER_PROVIDED };

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

/** The tenant config as the app would merge it: no YAML here, only the base override. */
const getTenantConfig = async (): Promise<AppConfig> => {
  const base = await db.findConfigByPrincipal(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID, {
    includeInactive: true,
  });
  return (base?.overrides ?? {}) as AppConfig;
};

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
  const recordAdminAction = createAdminAuditRecorder(db.recordAuditEntry);
  const tools = createAdminToolsHandlers({
    listTools: () => TOOLS,
    getTenantConfig,
    findConfigByPrincipal: db.findConfigByPrincipal,
    upsertConfig: db.upsertConfig,
    findPluginAuthsByKeys: db.findPluginAuthsByKeys,
    updatePluginAuth: db.updatePluginAuth,
    deletePluginAuth: db.deletePluginAuth,
    encrypt: async (value) => `sealed:${value}`,
    env: ENV,
    hasCapability,
    recordAdminAction,
  });
  const mcp = createAdminMCPHandlers({
    listAdminMCPServers: db.listAdminMCPServers,
    summarizeMCPServerSharing: db.summarizeMCPServerSharing,
    getYamlConfig: async () =>
      ({ mcpConfig: { filesystem: { command: 'npx', args: [] } } }) as unknown as AppConfig,
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
  admin.get('/tools', gate(SystemCapabilities.READ_CONFIGS), mount(tools.list));
  admin.patch('/tools/:key', gate(SystemCapabilities.MANAGE_CONFIGS), mount(tools.update));
  admin.get('/mcp', gate(SystemCapabilities.MANAGE_MCP_SERVERS), mount(mcp.list));
  app.use('/admin', admin);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('tools and MCP servers from the admin panel (real database)', () => {
  let superAdmin: TestUser;
  let employee: TestUser;

  beforeAll(async () => {
    superAdmin = await makeUser('root@example.com', SystemRoles.ADMIN);
    employee = await makeUser('staff@example.com', SystemRoles.USER);
  });

  it('keeps employees out', async () => {
    as(employee);
    const responses = await Promise.all([
      request(app).get('/admin/tools'),
      request(app).patch('/admin/tools/dalle').send({ enabled: false }),
      request(app).get('/admin/mcp'),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expect((await getTenantConfig()).filteredTools).toBeUndefined();
  });

  it('lists every tool as enabled with where its keys come from', async () => {
    as(superAdmin);
    const { body } = (await request(app).get('/admin/tools').expect(200)) as {
      body: TAdminTools;
    };
    expect(body.canManage).toBe(true);
    expect(body.tools.map((tool) => [tool.key, tool.enabled])).toEqual([
      ['tavily_search_results_json', true],
      ['dalle', true],
    ]);
    expect(body.tools[0].credentials[0]).toMatchObject({ field: 'TAVILY_API_KEY', source: 'user' });
    expect(body.tools[1].credentials[0]).toMatchObject({
      field: 'DALLE3_API_KEY',
      source: 'missing',
    });
  });

  it('switches a tool off for everyone through the base config and records it', async () => {
    as(superAdmin);
    const response = await request(app)
      .patch('/admin/tools/dalle')
      .send({ enabled: false })
      .expect(200);
    expect(response.body.tool).toMatchObject({ key: 'dalle', enabled: false });
    expect((await getTenantConfig()).filteredTools).toEqual(['dalle']);

    await request(app).patch('/admin/tools/dalle').send({ enabled: true }).expect(200);
    expect((await getTenantConfig()).filteredTools).toEqual([]);

    const page = await db.listAuditLogPage(undefined, { action: ['tool.disabled'] });
    expect(page.entries[0]).toMatchObject({ target: { type: 'tool', id: 'dalle' } });
  });

  it('stores a key for everyone, encrypted, that the tool loader then prefers', async () => {
    as(superAdmin);
    const response = await request(app)
      .patch('/admin/tools/tavily_search_results_json')
      .send({ credentials: { TAVILY_API_KEY: 'org-key' } })
      .expect(200);
    expect(response.body.tool.credentials[0].source).toBe('system');

    const stored = await db.findOnePluginAuth({
      userId: SYSTEM_TOOL_CREDENTIALS_OWNER,
      authField: 'TAVILY_API_KEY',
    });
    expect(stored?.value).toBe('sealed:org-key');

    const lookup = withSystemToolCredentials(async (userId, authField) => {
      const row = await db.findOnePluginAuth({ userId, authField });
      return row ? row.value.replace('sealed:', '') : null;
    });
    await expect(lookup(employee.id, 'TAVILY_API_KEY', false)).resolves.toBe('org-key');

    const audit = await db.listAuditLogPage(undefined, { action: ['tool.credentials_updated'] });
    expect(JSON.stringify(audit.entries[0])).not.toContain('org-key');

    await request(app)
      .patch('/admin/tools/tavily_search_results_json')
      .send({ credentials: { TAVILY_API_KEY: null } })
      .expect(200);
    expect(
      await db.findOnePluginAuth({
        userId: SYSTEM_TOOL_CREDENTIALS_OWNER,
        authField: 'TAVILY_API_KEY',
      }),
    ).toBeNull();
  });

  it('refuses unknown tools and fields', async () => {
    as(superAdmin);
    const responses = await Promise.all([
      request(app).patch('/admin/tools/nope').send({ enabled: false }),
      request(app)
        .patch('/admin/tools/dalle')
        .send({ credentials: { OTHER_KEY: 'x' } }),
      request(app).patch('/admin/tools/dalle').send({}),
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 400, 400]);
  });

  it('lists every stored MCP server with its author and sharing, beside the YAML ones', async () => {
    as(superAdmin);
    const own = await db.createMCPServer({
      config: { title: 'Knowledge Base', type: 'sse', url: 'https://kb.example.com/sse' },
      author: superAdmin.id,
    });
    await db.createMCPServer({
      config: { title: 'Staff Tools', type: 'streamable-http', url: 'https://staff.example.com' },
      author: employee.id,
    });
    await mongoose.models.AclEntry.create({
      principalType: PrincipalType.PUBLIC,
      resourceType: ResourceType.MCPSERVER,
      resourceId: own._id,
      permBits: 1,
      grantedBy: new mongoose.Types.ObjectId(superAdmin.id),
    });

    const { body } = (await request(app).get('/admin/mcp').expect(200)) as {
      body: TAdminMCPServersPage;
    };
    expect(body.total).toBe(2);
    expect(body.configured).toEqual([
      expect.objectContaining({ serverName: 'filesystem', transport: 'stdio' }),
    ]);
    const byTitle = new Map(body.servers.map((server) => [server.title, server]));
    expect(byTitle.get('Knowledge Base')).toMatchObject({
      transport: 'sse',
      authorName: 'root',
      isPublic: true,
    });
    expect(byTitle.get('Staff Tools')).toMatchObject({ authorName: 'staff', isPublic: false });

    const search = await request(app).get('/admin/mcp?search=staff').expect(200);
    expect(search.body.servers).toHaveLength(1);
  });
});
