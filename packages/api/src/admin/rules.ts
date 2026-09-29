import type { AuditTrailRule } from './trail';

type Body = Record<string, unknown>;

const bodyOf = (req: { body?: unknown }): Body =>
  req.body != null && typeof req.body === 'object' ? (req.body as Body) : {};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, 256) : undefined;

const fieldList = (body: Body): string =>
  Object.keys(body)
    .filter((key) => key !== 'password')
    .sort()
    .join(',');

function responseId(response: unknown, key: string): string | undefined {
  const record = (response as Body | undefined)?.[key] as Body | undefined;
  const id = record?._id ?? record?.id;
  return id != null ? String(id) : undefined;
}

/** Audit rules for `/api/admin/groups`. */
export const groupAuditRules: AuditTrailRule[] = [
  {
    method: 'POST',
    path: /^\/?$/,
    describe: ({ req, response }) => ({
      action: 'group.created',
      target: { type: 'group', id: responseId(response, 'group'), name: text(bodyOf(req).name) },
    }),
  },
  {
    method: 'PATCH',
    path: /^\/([^/]+)\/?$/,
    describe: ({ req, params }) => ({
      action: 'group.updated',
      target: { type: 'group', id: params[0], name: text(bodyOf(req).name) },
      metadata: { fields: fieldList(bodyOf(req)) },
    }),
  },
  {
    method: 'DELETE',
    path: /^\/([^/]+)\/?$/,
    describe: ({ params }) => ({
      action: 'group.deleted',
      severity: 'warning',
      target: { type: 'group', id: params[0] },
    }),
  },
  {
    method: 'POST',
    path: /^\/([^/]+)\/members\/?$/,
    describe: ({ req, params }) => ({
      action: 'group.member_added',
      target: { type: 'group', id: params[0] },
      metadata: { userId: text(bodyOf(req).userId) ?? null },
    }),
  },
  {
    method: 'DELETE',
    path: /^\/([^/]+)\/members\/([^/]+)\/?$/,
    describe: ({ params }) => ({
      action: 'group.member_removed',
      target: { type: 'group', id: params[0] },
      metadata: { userId: params[1] },
    }),
  },
];

/** Audit rules for `/api/admin/roles`. */
export const roleAuditRules: AuditTrailRule[] = [
  {
    method: 'POST',
    path: /^\/?$/,
    describe: ({ req }) => ({
      action: 'role.created',
      target: { type: 'role', id: text(bodyOf(req).name), name: text(bodyOf(req).name) },
    }),
  },
  {
    method: 'PATCH',
    path: /^\/([^/]+)\/permissions\/?$/,
    describe: ({ req, params }) => ({
      action: 'role.permissions_updated',
      severity: 'warning',
      target: { type: 'role', id: params[0], name: params[0] },
      metadata: { permissions: fieldList((bodyOf(req).permissions as Body) ?? {}) },
    }),
  },
  {
    method: 'PATCH',
    path: /^\/([^/]+)\/?$/,
    describe: ({ req, params }) => ({
      action: 'role.updated',
      target: { type: 'role', id: params[0], name: text(bodyOf(req).name) ?? params[0] },
      metadata: { fields: fieldList(bodyOf(req)) },
    }),
  },
  {
    method: 'DELETE',
    path: /^\/([^/]+)\/?$/,
    describe: ({ params }) => ({
      action: 'role.deleted',
      severity: 'warning',
      target: { type: 'role', id: params[0], name: params[0] },
    }),
  },
  {
    method: 'POST',
    path: /^\/([^/]+)\/members\/?$/,
    describe: ({ req, params }) => ({
      action: 'role.member_added',
      severity: 'warning',
      target: { type: 'role', id: params[0], name: params[0] },
      metadata: { userId: text(bodyOf(req).userId) ?? null },
    }),
  },
  {
    method: 'DELETE',
    path: /^\/([^/]+)\/members\/([^/]+)\/?$/,
    describe: ({ params }) => ({
      action: 'role.member_removed',
      severity: 'warning',
      target: { type: 'role', id: params[0], name: params[0] },
      metadata: { userId: params[1] },
    }),
  },
];

const configTarget = (params: string[]) => ({
  type: 'config',
  id: `${params[0]}:${params[1]}`,
  name: params[1],
});

/** Audit rules for `/api/admin/config`. */
export const configAuditRules: AuditTrailRule[] = [
  {
    method: 'PUT',
    path: /^\/([^/]+)\/([^/]+)\/?$/,
    describe: ({ req, params }) => ({
      action: 'config.updated',
      target: configTarget(params),
      metadata: { sections: fieldList((bodyOf(req).overrides as Body) ?? {}) },
    }),
  },
  {
    method: 'PATCH',
    path: /^\/([^/]+)\/([^/]+)\/fields\/?$/,
    describe: ({ req, params }) => {
      const entries = bodyOf(req).entries;
      const paths = Array.isArray(entries)
        ? entries
            .map((entry) => (entry as Body)?.fieldPath)
            .filter((path): path is string => typeof path === 'string')
            .join(',')
        : '';
      return {
        action: 'config.updated',
        target: configTarget(params),
        metadata: { fields: paths.slice(0, 1024) },
      };
    },
  },
  {
    method: 'POST',
    path: /^\/([^/]+)\/([^/]+)\/fields\/tombstone\/?$/,
    describe: ({ req, params }) => ({
      action: 'config.updated',
      target: configTarget(params),
      metadata: { tombstone: text(bodyOf(req).fieldPath) ?? null },
    }),
  },
  {
    method: 'DELETE',
    path: /^\/([^/]+)\/([^/]+)\/fields\/?$/,
    describe: ({ req, params }) => ({
      action: 'config.deleted',
      target: configTarget(params),
      metadata: { field: text(bodyOf(req).fieldPath) ?? text(req.query?.fieldPath) ?? null },
    }),
  },
  {
    method: 'PATCH',
    path: /^\/([^/]+)\/([^/]+)\/active\/?$/,
    describe: ({ req, params }) => ({
      action: 'config.updated',
      target: configTarget(params),
      metadata: { isActive: bodyOf(req).isActive === true },
    }),
  },
  {
    method: 'DELETE',
    path: /^\/([^/]+)\/([^/]+)\/?$/,
    describe: ({ params }) => ({
      action: 'config.deleted',
      severity: 'warning',
      target: configTarget(params),
    }),
  },
];

const countOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** Audit rules for `/api/permissions` (resource sharing, including agents). */
export const permissionAuditRules: AuditTrailRule[] = [
  {
    method: 'PUT',
    path: /^\/([^/]+)\/([^/]+)\/?$/,
    describe: ({ req, params }) => {
      const body = bodyOf(req);
      return {
        action: params[0] === 'agent' ? 'agent.access_updated' : 'permission.access_updated',
        target: { type: params[0], id: params[1] },
        metadata: {
          updated: countOf(body.updated),
          removed: countOf(body.removed),
          public: body.public === true,
        },
      };
    },
  },
];

/** Audit rules for agent deletion through `/api/agents`. */
export const agentAuditRules: AuditTrailRule[] = [
  {
    method: 'DELETE',
    path: /^\/(agent_[^/]+)\/?$/,
    describe: ({ params }) => ({
      action: 'agent.deleted',
      severity: 'warning',
      target: { type: 'agent', id: params[0] },
    }),
  },
];
