import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type { AdminCapability } from '../context';
import type { TranslationKeys } from '~/hooks';
import { Cap } from '../context';

export type CapabilityGroup = {
  labelKey: TranslationKeys;
  items: { capability: AdminCapability; labelKey: TranslationKeys }[];
};

/** Administrative capabilities, grouped for the role editor. */
export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    labelKey: 'com_admin_cap_group_panel',
    items: [{ capability: Cap.ACCESS_ADMIN, labelKey: 'com_admin_cap_access_admin' }],
  },
  {
    labelKey: 'com_admin_cap_group_people',
    items: [
      { capability: Cap.READ_USERS, labelKey: 'com_admin_cap_read_users' },
      { capability: Cap.MANAGE_USERS, labelKey: 'com_admin_cap_manage_users' },
      { capability: Cap.READ_GROUPS, labelKey: 'com_admin_cap_read_groups' },
      { capability: Cap.MANAGE_GROUPS, labelKey: 'com_admin_cap_manage_groups' },
      { capability: Cap.READ_ROLES, labelKey: 'com_admin_cap_read_roles' },
      { capability: Cap.MANAGE_ROLES, labelKey: 'com_admin_cap_manage_roles' },
    ],
  },
  {
    labelKey: 'com_admin_cap_group_team',
    items: [
      { capability: Cap.READ_TEAM, labelKey: 'com_admin_cap_read_team' },
      { capability: Cap.MANAGE_TEAM, labelKey: 'com_admin_cap_manage_team' },
    ],
  },
  {
    labelKey: 'com_admin_cap_group_ai',
    items: [
      { capability: Cap.READ_MODELS, labelKey: 'com_admin_cap_read_models' },
      { capability: Cap.MANAGE_MODELS, labelKey: 'com_admin_cap_manage_models' },
      { capability: Cap.READ_AGENTS, labelKey: 'com_admin_cap_read_agents' },
      { capability: Cap.MANAGE_AGENTS, labelKey: 'com_admin_cap_manage_agents' },
    ],
  },
  {
    labelKey: 'com_admin_cap_group_usage',
    items: [
      { capability: Cap.READ_USAGE, labelKey: 'com_admin_cap_read_usage' },
      { capability: Cap.MANAGE_LIMITS, labelKey: 'com_admin_cap_manage_limits' },
    ],
  },
  {
    labelKey: 'com_admin_cap_group_system',
    items: [
      { capability: Cap.READ_CONFIGS, labelKey: 'com_admin_cap_read_configs' },
      { capability: Cap.MANAGE_CONFIGS, labelKey: 'com_admin_cap_manage_configs' },
      { capability: Cap.READ_AUDIT_LOG, labelKey: 'com_admin_cap_read_audit_log' },
    ],
  },
];

/**
 * Starting points offered when creating a role. They only pre-select capabilities;
 * the role is an ordinary editable role afterwards.
 */
export const ROLE_PRESETS: {
  value: string;
  labelKey: TranslationKeys;
  capabilities: AdminCapability[];
}[] = [
  { value: 'none', labelKey: 'com_admin_role_preset_none', capabilities: [] },
  {
    value: 'admin',
    labelKey: 'com_admin_role_preset_admin',
    capabilities: [
      Cap.ACCESS_ADMIN,
      Cap.MANAGE_USERS,
      Cap.MANAGE_GROUPS,
      Cap.READ_ROLES,
      Cap.MANAGE_MODELS,
      Cap.MANAGE_AGENTS,
      Cap.READ_USAGE,
      Cap.MANAGE_LIMITS,
      Cap.READ_AUDIT_LOG,
    ],
  },
  {
    value: 'manager',
    labelKey: 'com_admin_role_preset_manager',
    capabilities: [Cap.ACCESS_ADMIN, Cap.READ_TEAM, Cap.MANAGE_TEAM],
  },
];

export const PERMISSION_TYPE_LABELS: Partial<Record<PermissionTypes, TranslationKeys>> = {
  [PermissionTypes.PROMPTS]: 'com_admin_perm_type_prompts',
  [PermissionTypes.BOOKMARKS]: 'com_admin_perm_type_bookmarks',
  [PermissionTypes.AGENTS]: 'com_admin_perm_type_agents',
  [PermissionTypes.MEMORIES]: 'com_admin_perm_type_memories',
  [PermissionTypes.MULTI_CONVO]: 'com_admin_perm_type_multi_convo',
  [PermissionTypes.TEMPORARY_CHAT]: 'com_admin_perm_type_temporary_chat',
  [PermissionTypes.RUN_CODE]: 'com_admin_perm_type_run_code',
  [PermissionTypes.WEB_SEARCH]: 'com_admin_perm_type_web_search',
  [PermissionTypes.PEOPLE_PICKER]: 'com_admin_perm_type_people_picker',
  [PermissionTypes.MARKETPLACE]: 'com_admin_perm_type_marketplace',
  [PermissionTypes.FILE_SEARCH]: 'com_admin_perm_type_file_search',
  [PermissionTypes.FILE_CITATIONS]: 'com_admin_perm_type_file_citations',
  [PermissionTypes.MCP_SERVERS]: 'com_admin_perm_type_mcp_servers',
  [PermissionTypes.REMOTE_AGENTS]: 'com_admin_perm_type_remote_agents',
  [PermissionTypes.SKILLS]: 'com_admin_perm_type_skills',
  [PermissionTypes.SHARED_LINKS]: 'com_admin_perm_type_shared_links',
  [PermissionTypes.SCHEDULES]: 'com_admin_perm_type_schedules',
};

export const PERMISSION_LABELS: Partial<Record<Permissions, TranslationKeys>> = {
  [Permissions.USE]: 'com_admin_perm_use',
  [Permissions.CREATE]: 'com_admin_perm_create',
  [Permissions.UPDATE]: 'com_admin_perm_update',
  [Permissions.READ]: 'com_admin_perm_read',
  [Permissions.READ_AUTHOR]: 'com_admin_perm_read_author',
  [Permissions.SHARE]: 'com_admin_perm_share',
  [Permissions.SHARE_PUBLIC]: 'com_admin_perm_share_public',
  [Permissions.OPT_OUT]: 'com_admin_perm_opt_out',
  [Permissions.VIEW_USERS]: 'com_admin_perm_view_users',
  [Permissions.VIEW_GROUPS]: 'com_admin_perm_view_groups',
  [Permissions.VIEW_ROLES]: 'com_admin_perm_view_roles',
  [Permissions.CONFIGURE_OBO]: 'com_admin_perm_configure_obo',
};
