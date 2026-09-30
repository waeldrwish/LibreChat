import { z } from 'zod';
import { PrincipalType, PrincipalModel } from 'librechat-data-provider';
import { logger, SystemCapabilities, BASE_CONFIG_PRINCIPAL_ID } from '@librechat/data-schemas';
import type {
  IConfig,
  AppConfig,
  SystemCapability,
  PluginAuthMethods,
} from '@librechat/data-schemas';
import type { TPlugin, TAdminTool, TAdminTools } from 'librechat-data-provider';
import type { Response } from 'express';
import type { AdminAuditRecorder, AdminHandler } from './trail';
import type { ServerRequest } from '~/types/http';
import type { CapabilityUser } from './scope';
import {
  toolCredentialFields,
  toolCredentialSource,
  findSystemToolFields,
  SYSTEM_TOOL_CREDENTIALS_OWNER,
} from '~/tools/credentials';
import { isToolEnabled, setToolEnabled } from '~/tools/availability';
import { resolveAdminActor } from './trail';
import { toCapabilityUser } from './scope';

export interface AdminToolsDeps {
  /** The tool manifest, one entry per plugin key. */
  listTools: () => TPlugin[];
  /** The tenant-wide config (YAML merged with the base DB override). */
  getTenantConfig: (tenantId?: string) => Promise<AppConfig>;
  findConfigByPrincipal: (
    principalType: PrincipalType,
    principalId: string,
    options?: { includeInactive?: boolean },
  ) => Promise<IConfig | null>;
  upsertConfig: (
    principalType: PrincipalType,
    principalId: string,
    principalModel: PrincipalModel,
    overrides: Record<string, unknown>,
    priority: number,
    session?: undefined,
    options?: { expectEmpty?: boolean; preservePriority?: boolean },
  ) => Promise<IConfig | null>;
  invalidateConfigCaches?: (tenantId?: string) => Promise<unknown>;
  findPluginAuthsByKeys: PluginAuthMethods['findPluginAuthsByKeys'];
  updatePluginAuth: PluginAuthMethods['updatePluginAuth'];
  deletePluginAuth: PluginAuthMethods['deletePluginAuth'];
  encrypt: (value: string) => Promise<string>;
  /** Read for keys the server environment already provides. */
  env: Record<string, string | undefined>;
  hasCapability: (user: CapabilityUser, capability: SystemCapability) => Promise<boolean>;
  recordAdminAction: AdminAuditRecorder;
}

const updateSchema = z
  .object({
    enabled: z.boolean().optional(),
    credentials: z
      .record(z.string().min(1).max(128), z.string().trim().min(1).max(4096).nullable())
      .optional(),
  })
  .refine((body) => body.enabled !== undefined || body.credentials !== undefined, {
    message: 'Nothing to update',
  });

function toAdminTool(
  plugin: TPlugin,
  config: AppConfig | null | undefined,
  env: Record<string, string | undefined>,
  systemFields: ReadonlySet<string>,
): TAdminTool {
  return {
    key: plugin.pluginKey,
    name: plugin.name,
    description: plugin.description,
    icon: plugin.icon,
    enabled: isToolEnabled(config, plugin.pluginKey),
    credentials: toolCredentialFields(plugin).map((field) => ({
      field: field.field,
      label: field.label,
      description: field.description,
      optional: field.optional,
      source: toolCredentialSource(field.alternates, env, systemFields),
    })),
  };
}

/**
 * Tools ("plugins") from the admin panel: switching a tool on or off for the
 * whole organization and storing the keys it needs so users are not asked for
 * their own. Keys live in `PluginAuth`, encrypted, under a sentinel owner.
 */
export function createAdminToolsHandlers(
  deps: AdminToolsDeps,
): Record<'list' | 'update', AdminHandler> {
  const loadSystemFields = (plugins: TPlugin[]): Promise<Set<string>> =>
    findSystemToolFields(
      deps.findPluginAuthsByKeys,
      plugins.map((plugin) => plugin.pluginKey),
    );

  async function list(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const plugins = deps.listTools();
      const [config, systemFields, canManage] = await Promise.all([
        deps.getTenantConfig(actor.tenantId),
        loadSystemFields(plugins),
        deps.hasCapability(toCapabilityUser(actor), SystemCapabilities.MANAGE_CONFIGS),
      ]);
      const body: TAdminTools = {
        tools: plugins.map((plugin) => toAdminTool(plugin, config, deps.env, systemFields)),
        canManage,
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminTools] list error:', error);
      return res.status(500).json({ error: 'Failed to list tools' });
    }
  }

  async function writeEnabled(tenantId: string | undefined, key: string, enabled: boolean) {
    const [config, existing] = await Promise.all([
      deps.getTenantConfig(tenantId),
      deps.findConfigByPrincipal(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID, {
        includeInactive: true,
      }),
    ]);
    const overrides = (existing?.overrides ?? {}) as Record<string, unknown>;
    await deps.upsertConfig(
      PrincipalType.ROLE,
      BASE_CONFIG_PRINCIPAL_ID,
      PrincipalModel.ROLE,
      { ...overrides, ...setToolEnabled(config, key, enabled) },
      existing?.priority ?? 0,
      undefined,
      { expectEmpty: false },
    );
    await deps
      .invalidateConfigCaches?.(tenantId)
      ?.catch((error: unknown) =>
        logger.error('[adminTools] Config cache invalidation failed:', error),
      );
  }

  async function update(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { key } = req.params as { key: string };
      const plugins = deps.listTools();
      const plugin = plugins.find((item) => item.pluginKey === key);
      if (!plugin) {
        return res.status(404).json({ error: 'Tool not found' });
      }
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid body' });
      }
      const { enabled, credentials } = parsed.data;
      const fields = new Set(toolCredentialFields(plugin).map((field) => field.field));
      const unknownField = Object.keys(credentials ?? {}).find((field) => !fields.has(field));
      if (unknownField) {
        return res.status(400).json({ error: `Unknown credential field: ${unknownField}` });
      }

      if (credentials) {
        await Promise.all(
          Object.entries(credentials).map(async ([authField, value]) =>
            value == null
              ? deps.deletePluginAuth({ userId: SYSTEM_TOOL_CREDENTIALS_OWNER, authField })
              : deps.updatePluginAuth({
                  userId: SYSTEM_TOOL_CREDENTIALS_OWNER,
                  authField,
                  pluginKey: key,
                  value: await deps.encrypt(value),
                }),
          ),
        );
        await deps.recordAdminAction(req, {
          action: 'tool.credentials_updated',
          severity: 'warning',
          target: { type: 'tool', id: key, name: plugin.name },
          metadata: {
            set: Object.keys(credentials)
              .filter((field) => credentials[field] != null)
              .join(','),
            removed: Object.keys(credentials)
              .filter((field) => credentials[field] == null)
              .join(','),
          },
        });
      }

      if (enabled !== undefined) {
        await writeEnabled(actor.tenantId, key, enabled);
        await deps.recordAdminAction(req, {
          action: enabled ? 'tool.enabled' : 'tool.disabled',
          severity: enabled ? 'info' : 'warning',
          target: { type: 'tool', id: key, name: plugin.name },
        });
      }

      const [config, systemFields] = await Promise.all([
        deps.getTenantConfig(actor.tenantId),
        loadSystemFields([plugin]),
      ]);
      return res.status(200).json({ tool: toAdminTool(plugin, config, deps.env, systemFields) });
    } catch (error) {
      logger.error('[adminTools] update error:', error);
      return res.status(500).json({ error: 'Failed to update tool' });
    }
  }

  return { list, update };
}
