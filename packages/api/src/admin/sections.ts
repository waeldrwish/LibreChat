import { z } from 'zod';
import { logger, SystemCapabilities } from '@librechat/data-schemas';
import {
  SystemRoles,
  PrincipalType,
  CHAT_SECTIONS,
  PrincipalModel,
  PERMISSION_TYPE_INTERFACE_FIELDS,
} from 'librechat-data-provider';
import type { IRole, IConfig, AppConfig, SystemCapability } from '@librechat/data-schemas';
import type { TAdminSections, TAdminSectionsRole } from 'librechat-data-provider';
import type { Response } from 'express';
import type { AdminAuditRecorder, AdminHandler } from './trail';
import type { ServerRequest } from '~/types/http';
import type { CapabilityUser } from './scope';
import { resolveAdminActor } from './trail';
import { toCapabilityUser } from './scope';

/** Priority the admin config API gives principal overrides, so these rank alongside them. */
const ROLE_OVERRIDE_PRIORITY = 10;
const MAX_ROLES = 200;

type SectionDefinition = (typeof CHAT_SECTIONS)[number];
type InterfaceValues = Record<string, unknown>;

const SECTIONS = new Map<string, SectionDefinition>(
  CHAT_SECTIONS.map((section) => [section.key, section]),
);

const updateSchema = z.object({
  section: z.string().refine((key) => SECTIONS.has(key), { message: 'Unknown section' }),
  visible: z.boolean(),
});

export interface AdminSectionsDeps {
  listRoles: (params: { limit: number; offset: number }) => Promise<Pick<IRole, 'name'>[]>;
  getRoleByName: (name: string) => Promise<IRole | null>;
  updateAccessPermissions: (
    name: string,
    perms: Record<string, Record<string, boolean>>,
    roleData?: IRole,
  ) => Promise<unknown>;
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
  hasCapability: (user: CapabilityUser, capability: SystemCapability) => Promise<boolean>;
  recordAdminAction: AdminAuditRecorder;
}

const hasPermission = (
  section: SectionDefinition,
): section is Extract<SectionDefinition, { permissionType: string }> => 'permissionType' in section;

/** The `interface` field a section reads, whether or not a role permission backs it. */
const interfaceField = (section: SectionDefinition): string =>
  hasPermission(section) ? PERMISSION_TYPE_INTERFACE_FIELDS[section.permissionType] : section.key;

/** `false`, or `{ use: false }` for the composite permission fields. */
const isOff = (value: unknown): boolean =>
  value === false ||
  (value != null && typeof value === 'object' && (value as { use?: unknown }).use === false);

function roleVisibility(
  role: IRole,
  base: InterfaceValues,
  override: InterfaceValues,
): TAdminSectionsRole {
  const permissions = (role.permissions ?? {}) as Record<string, Record<string, boolean>>;
  const visible = Object.fromEntries(
    CHAT_SECTIONS.map((section) => {
      if (hasPermission(section)) {
        return [section.key, permissions[section.permissionType]?.[section.permission] === true];
      }
      const value = override[section.key] ?? base[section.key];
      return [section.key, value !== false];
    }),
  );
  return { name: role.name, visible };
}

/**
 * Which parts of the chat each role sees. Permission-backed sections change the role's
 * permission (enforced server-side too); interface-only sections are written to the
 * role's config override, never to the permission fields that seed role permissions.
 */
export function createAdminSectionsHandlers(
  deps: AdminSectionsDeps,
): Record<'list' | 'update', AdminHandler> {
  const roleOverride = async (name: string) =>
    deps.findConfigByPrincipal(PrincipalType.ROLE, name, { includeInactive: true });

  const overrideInterface = (config: IConfig | null): InterfaceValues =>
    ((config?.overrides as { interface?: InterfaceValues } | undefined)?.interface ??
      {}) as InterfaceValues;

  const baseInterface = async (tenantId?: string): Promise<InterfaceValues> =>
    ((await deps.getTenantConfig(tenantId))?.interfaceConfig ?? {}) as InterfaceValues;

  async function list(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const [names, base, canManage] = await Promise.all([
        deps.listRoles({ limit: MAX_ROLES, offset: 0 }),
        baseInterface(actor.tenantId),
        deps.hasCapability(toCapabilityUser(actor), SystemCapabilities.MANAGE_ROLES),
      ]);
      /** System roles always appear, even before their documents are first written. */
      const roleNames = [
        ...new Set([SystemRoles.ADMIN, SystemRoles.USER, ...names.map(({ name }) => name)]),
      ];
      const loaded = await Promise.all(
        roleNames.map((name) => Promise.all([deps.getRoleByName(name), roleOverride(name)])),
      );
      const body: TAdminSections = {
        roles: loaded
          .filter((entry): entry is [IRole, IConfig | null] => entry[0] != null)
          .map(([role, override]) => roleVisibility(role, base, overrideInterface(override))),
        globallyOff: CHAT_SECTIONS.filter((section) => isOff(base[interfaceField(section)])).map(
          (section) => section.key,
        ),
        canManage,
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminSections] list error:', error);
      return res.status(500).json({ error: 'Failed to load chat sections' });
    }
  }

  async function update(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { role: name } = req.params as { role: string };
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid body' });
      }
      const role = await deps.getRoleByName(name);
      if (!role) {
        return res.status(404).json({ error: 'Role not found' });
      }
      const section = SECTIONS.get(parsed.data.section) as SectionDefinition;
      const { visible } = parsed.data;

      if (hasPermission(section)) {
        await deps.updateAccessPermissions(
          name,
          { [section.permissionType]: { [section.permission]: visible } },
          role,
        );
      } else {
        const [existing, base] = await Promise.all([
          roleOverride(name),
          baseInterface(actor.tenantId),
        ]);
        const overrides = (existing?.overrides ?? {}) as Record<string, unknown>;
        const current = { ...overrideInterface(existing) };
        /** Showing a section the deployment shows anyway drops the override instead of pinning it. */
        if (visible && base[section.key] !== false) {
          delete current[section.key];
        } else {
          current[section.key] = visible;
        }
        await deps.upsertConfig(
          PrincipalType.ROLE,
          name,
          PrincipalModel.ROLE,
          { ...overrides, interface: current },
          existing?.priority ?? ROLE_OVERRIDE_PRIORITY,
          undefined,
          { expectEmpty: false },
        );
        await deps
          .invalidateConfigCaches?.(actor.tenantId)
          ?.catch((error: unknown) =>
            logger.error('[adminSections] Config cache invalidation failed:', error),
          );
      }

      await deps.recordAdminAction(req, {
        action: 'role.permissions_updated',
        severity: 'info',
        target: { type: 'role', id: name, name },
        metadata: { section: section.key, visible },
      });

      const [updated, base, override] = await Promise.all([
        deps.getRoleByName(name),
        baseInterface(actor.tenantId),
        roleOverride(name),
      ]);
      return res.status(200).json({
        role: roleVisibility(updated ?? role, base, overrideInterface(override)),
      });
    } catch (error) {
      logger.error('[adminSections] update error:', error);
      return res.status(500).json({ error: 'Failed to update chat section' });
    }
  }

  return { list, update };
}
