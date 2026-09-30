import { AuthType } from 'librechat-data-provider';
import type { TPlugin } from 'librechat-data-provider';
import {
  toolCredentialFields,
  toolCredentialSource,
  withSystemToolCredentials,
  SYSTEM_TOOL_CREDENTIALS_OWNER,
} from './credentials';

describe('toolCredentialFields', () => {
  it('stores an alternate field under its first name', () => {
    const plugin: TPlugin = {
      name: 'DALL-E',
      pluginKey: 'dalle',
      authConfig: [
        { authField: 'DALLE3_API_KEY||DALLE_API_KEY', label: 'Key', description: 'Your key' },
      ],
    };
    expect(toolCredentialFields(plugin)).toEqual([
      {
        field: 'DALLE3_API_KEY',
        alternates: ['DALLE3_API_KEY', 'DALLE_API_KEY'],
        label: 'Key',
        description: 'Your key',
        optional: false,
      },
    ]);
  });
});

describe('toolCredentialSource', () => {
  const none = new Set<string>();

  it('reads the environment first', () => {
    expect(toolCredentialSource(['KEY'], { KEY: 'value' }, new Set(['KEY']))).toBe('env');
  });

  it('falls back to a stored key, then to each user', () => {
    expect(toolCredentialSource(['KEY'], { KEY: AuthType.USER_PROVIDED }, new Set(['KEY']))).toBe(
      'system',
    );
    expect(toolCredentialSource(['KEY'], { KEY: AuthType.USER_PROVIDED }, none)).toBe('user');
    expect(toolCredentialSource(['KEY'], { KEY: '  ' }, none)).toBe('missing');
  });

  it('accepts any alternate', () => {
    expect(toolCredentialSource(['A', 'B'], { B: 'value' }, none)).toBe('env');
  });
});

describe('withSystemToolCredentials', () => {
  it('prefers the stored key and asks the user only without one', async () => {
    const stored = new Map([['KEY', 'org-key']]);
    const lookup = jest.fn(async (userId: string, field: string) =>
      userId === SYSTEM_TOOL_CREDENTIALS_OWNER ? (stored.get(field) ?? null) : 'user-key',
    );
    const resolve = withSystemToolCredentials(lookup);

    await expect(resolve('user-1', 'KEY', true)).resolves.toBe('org-key');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(SYSTEM_TOOL_CREDENTIALS_OWNER, 'KEY', false);

    stored.clear();
    await expect(resolve('user-1', 'KEY', true, 'dalle')).resolves.toBe('user-key');
    expect(lookup).toHaveBeenLastCalledWith('user-1', 'KEY', true, 'dalle');
  });
});
