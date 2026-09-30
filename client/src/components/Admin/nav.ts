import {
  Bot,
  Cpu,
  Plug,
  Gauge,
  Users,
  Puzzle,
  Server,
  Settings,
  UsersRound,
  ScrollText,
  BarChart3,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AdminCapability } from './context';
import type { TranslationKeys } from '~/hooks';
import { Cap } from './context';

export type AdminNavItem = {
  path: string;
  labelKey: TranslationKeys;
  icon: LucideIcon;
  /** Visible when the viewer holds any of these. */
  anyOf: AdminCapability[];
};

export type AdminNavSection = { labelKey: TranslationKeys; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavSection[] = [
  {
    labelKey: 'com_admin_nav_section_home',
    items: [
      {
        path: '',
        labelKey: 'com_admin_nav_overview',
        icon: Gauge,
        anyOf: [Cap.READ_USAGE, Cap.READ_TEAM],
      },
    ],
  },
  {
    labelKey: 'com_admin_nav_section_people',
    items: [
      {
        path: 'users',
        labelKey: 'com_admin_nav_users',
        icon: Users,
        anyOf: [Cap.READ_USERS, Cap.READ_TEAM],
      },
      {
        path: 'groups',
        labelKey: 'com_admin_nav_groups',
        icon: UsersRound,
        anyOf: [Cap.READ_GROUPS],
      },
      {
        path: 'roles',
        labelKey: 'com_admin_nav_roles',
        icon: ShieldCheck,
        anyOf: [Cap.READ_ROLES],
      },
    ],
  },
  {
    labelKey: 'com_admin_nav_section_ai',
    items: [
      { path: 'models', labelKey: 'com_admin_nav_models', icon: Cpu, anyOf: [Cap.READ_MODELS] },
      {
        path: 'providers',
        labelKey: 'com_admin_nav_providers',
        icon: Server,
        anyOf: [Cap.READ_MODELS],
      },
      { path: 'agents', labelKey: 'com_admin_nav_agents', icon: Bot, anyOf: [Cap.READ_AGENTS] },
      {
        path: 'mcp',
        labelKey: 'com_admin_nav_mcp',
        icon: Plug,
        anyOf: [Cap.MANAGE_MCP_SERVERS],
      },
      { path: 'tools', labelKey: 'com_admin_nav_tools', icon: Puzzle, anyOf: [Cap.READ_CONFIGS] },
    ],
  },
  {
    labelKey: 'com_admin_nav_section_usage',
    items: [
      {
        path: 'usage',
        labelKey: 'com_admin_nav_usage',
        icon: BarChart3,
        anyOf: [Cap.READ_USAGE, Cap.READ_TEAM],
      },
      {
        path: 'limits',
        labelKey: 'com_admin_nav_limits',
        icon: SlidersHorizontal,
        anyOf: [Cap.READ_USAGE, Cap.MANAGE_LIMITS, Cap.READ_TEAM],
      },
    ],
  },
  {
    labelKey: 'com_admin_nav_section_system',
    items: [
      {
        path: 'audit',
        labelKey: 'com_admin_nav_audit',
        icon: ScrollText,
        anyOf: [Cap.READ_AUDIT_LOG],
      },
      {
        path: 'settings',
        labelKey: 'com_admin_nav_settings',
        icon: Settings,
        anyOf: [Cap.READ_CONFIGS],
      },
    ],
  },
];
