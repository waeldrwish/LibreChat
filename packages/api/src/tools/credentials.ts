import { AuthType } from 'librechat-data-provider';
import type { TPlugin, TToolCredentialSource } from 'librechat-data-provider';

/**
 * `PluginAuth.userId` for the keys an administrator stores for everyone. No user
 * id can take this value, so a user's own key lookups never reach these rows.
 */
export const SYSTEM_TOOL_CREDENTIALS_OWNER = '__system__';

export type AuthValueLookup = (
  userId: string,
  authField: string,
  throwError?: boolean,
  pluginKey?: string,
) => Promise<string | null | undefined>;

/**
 * Resolves a tool key from the administrator's stored key first and the user's
 * own key second. The server environment is read before either, by the caller.
 */
export function withSystemToolCredentials(lookup: AuthValueLookup): AuthValueLookup {
  return async (userId, authField, ...rest) => {
    const system = await lookup(SYSTEM_TOOL_CREDENTIALS_OWNER, authField, false);
    if (system) {
      return system;
    }
    return lookup(userId, authField, ...rest);
  };
}

type FindPluginAuths = (params: {
  userId: string;
  pluginKeys: string[];
}) => Promise<Array<{ authField: string }>>;

/** The fields an administrator stored a key for, among these tools. */
export async function findSystemToolFields(
  findPluginAuthsByKeys: FindPluginAuths,
  pluginKeys: string[],
): Promise<Set<string>> {
  const rows = await findPluginAuthsByKeys({
    userId: SYSTEM_TOOL_CREDENTIALS_OWNER,
    pluginKeys,
  });
  return new Set(rows.map((row) => row.authField));
}

export type ToolCredentialField = {
  /** Stored under the first alternate of an `A||B` field. */
  field: string;
  alternates: string[];
  label: string;
  description?: string;
  optional: boolean;
};

export function toolCredentialFields(plugin: TPlugin): ToolCredentialField[] {
  return (plugin.authConfig ?? []).map((entry) => {
    const alternates = entry.authField.split('||');
    return {
      field: alternates[0],
      alternates,
      label: entry.label,
      description: entry.description,
      optional: entry.optional === true,
    };
  });
}

const isServerValue = (value?: string): boolean =>
  value != null && value.trim() !== '' && value !== AuthType.USER_PROVIDED;

/** Where a tool field's key comes from, in the order `loadAuthValues` reads them. */
export function toolCredentialSource(
  alternates: string[],
  env: Record<string, string | undefined>,
  systemFields: ReadonlySet<string>,
): TToolCredentialSource {
  if (alternates.some((field) => isServerValue(env[field]))) {
    return 'env';
  }
  if (alternates.some((field) => systemFields.has(field))) {
    return 'system';
  }
  if (alternates.some((field) => env[field] === AuthType.USER_PROVIDED)) {
    return 'user';
  }
  return 'missing';
}
