import { createContext, useContext, useMemo } from 'react';
import type { TAdminSession } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import i18n from '~/locales/i18n';

/** Capability strings the panel gates its sections on (mirrors the server's SystemCapabilities). */
export const Cap = {
  ACCESS_ADMIN: 'access:admin',
  READ_USERS: 'read:users',
  MANAGE_USERS: 'manage:users',
  READ_GROUPS: 'read:groups',
  MANAGE_GROUPS: 'manage:groups',
  READ_ROLES: 'read:roles',
  MANAGE_ROLES: 'manage:roles',
  READ_CONFIGS: 'read:configs',
  MANAGE_CONFIGS: 'manage:configs',
  READ_USAGE: 'read:usage',
  READ_AGENTS: 'read:agents',
  MANAGE_AGENTS: 'manage:agents',
  MANAGE_MCP_SERVERS: 'manage:mcpservers',
  READ_MODELS: 'read:models',
  MANAGE_MODELS: 'manage:models',
  MANAGE_LIMITS: 'manage:limits',
  READ_TEAM: 'read:team',
  MANAGE_TEAM: 'manage:team',
  READ_AUDIT_LOG: 'read:audit_log',
} as const;

export type AdminCapability = (typeof Cap)[keyof typeof Cap];

type AdminContextValue = {
  session: TAdminSession;
  /** Locale the panel renders in, used for number and date formatting. */
  locale: string;
  /** Text direction of the panel language, for Radix primitives that take `dir`. */
  dir: 'ltr' | 'rtl';
  isTeamScope: boolean;
  can: (...capabilities: AdminCapability[]) => boolean;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminContextProvider({
  session,
  locale,
  children,
}: {
  session: TAdminSession;
  locale: string;
  children: ReactNode;
}) {
  const value = useMemo<AdminContextValue>(() => {
    const held = new Set(session.capabilities);
    return {
      session,
      locale,
      dir: i18n.dir(locale),
      isTeamScope: session.scope === 'team',
      /** True when the viewer holds any of the given capabilities. */
      can: (...capabilities) => capabilities.some((capability) => held.has(capability)),
    };
  }, [session, locale]);
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) {
    throw new Error('useAdmin must be used inside the admin panel');
  }
  return value;
}
