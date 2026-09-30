import type { RouteObject } from 'react-router-dom';
import type { ComponentType } from 'react';

type AdminModule = typeof import('~/components/Admin');

/** Every admin screen ships in one lazily loaded chunk; the chat bundle never carries it. */
const page = (name: keyof AdminModule) => () =>
  import('~/components/Admin').then((module) => ({
    Component: module[name] as ComponentType,
  }));

const adminRoutes: RouteObject = {
  path: 'admin',
  lazy: page('AdminLayout'),
  children: [
    { index: true, lazy: page('OverviewPage') },
    { path: 'users', lazy: page('UsersPage') },
    { path: 'users/:id', lazy: page('UserDetailPage') },
    { path: 'groups', lazy: page('GroupsPage') },
    { path: 'groups/:id', lazy: page('GroupDetailPage') },
    { path: 'roles', lazy: page('RolesPage') },
    { path: 'roles/:name', lazy: page('RoleDetailPage') },
    { path: 'models', lazy: page('ModelsPage') },
    { path: 'providers', lazy: page('ProvidersPage') },
    { path: 'agents', lazy: page('AgentsPage') },
    { path: 'mcp', lazy: page('MCPServersPage') },
    { path: 'tools', lazy: page('ToolsPage') },
    { path: 'usage', lazy: page('UsagePage') },
    { path: 'limits', lazy: page('LimitsPage') },
    { path: 'audit', lazy: page('AuditLogPage') },
    { path: 'settings', lazy: page('SettingsPage') },
  ],
};

export default adminRoutes;
