const { AuthType } = require('librechat-data-provider');

jest.mock('~/server/services/PluginService', () => ({
  getUserPluginAuthValue: jest.fn(),
}));

const { getUserPluginAuthValue } = require('~/server/services/PluginService');
const { SYSTEM_TOOL_CREDENTIALS_OWNER } = require('@librechat/api');
const { loadAuthValues } = require('./credentials');

/** Keys an administrator stored, answered the way the real lookup answers `throwError: false`. */
const systemKeys = new Map();
const userLookup = jest.fn();

describe('loadAuthValues', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    systemKeys.clear();
    getUserPluginAuthValue.mockImplementation((userId, ...rest) =>
      userId === SYSTEM_TOOL_CREDENTIALS_OWNER
        ? Promise.resolve(systemKeys.get(rest[0]) ?? null)
        : userLookup(userId, ...rest),
    );
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return env value when set to a real key', async () => {
    process.env.MY_API_KEY = 'real-key-123';

    const result = await loadAuthValues({
      userId: 'user1',
      authFields: ['MY_API_KEY'],
    });

    expect(result).toEqual({ MY_API_KEY: 'real-key-123' });
  });

  it('should skip user_provided sentinel and try user DB value', async () => {
    process.env.GOOGLE_KEY = AuthType.USER_PROVIDED;
    userLookup.mockResolvedValue('user-stored-key');

    const result = await loadAuthValues({
      userId: 'user1',
      authFields: ['GOOGLE_KEY'],
    });

    expect(userLookup).toHaveBeenCalledWith('user1', 'GOOGLE_KEY', true);
    expect(result).toEqual({ GOOGLE_KEY: 'user-stored-key' });
  });

  it('should skip user_provided and continue to next field in fallback chain', async () => {
    process.env.GOOGLE_KEY = AuthType.USER_PROVIDED;
    process.env.GOOGLE_SERVICE_KEY_FILE = '/path/to/service-account.json';
    userLookup.mockRejectedValue(new Error('No auth found'));

    const result = await loadAuthValues({
      userId: 'user1',
      authFields: ['GEMINI_API_KEY||GOOGLE_KEY||GOOGLE_SERVICE_KEY_FILE'],
    });

    expect(result).toEqual({ GOOGLE_SERVICE_KEY_FILE: '/path/to/service-account.json' });
  });

  it('should skip empty and whitespace-only env values', async () => {
    process.env.EMPTY_KEY = '';
    process.env.WHITESPACE_KEY = '   ';
    process.env.REAL_KEY = 'valid';

    const result = await loadAuthValues({
      userId: 'user1',
      authFields: ['EMPTY_KEY||WHITESPACE_KEY||REAL_KEY'],
    });

    expect(result).toEqual({ REAL_KEY: 'valid' });
  });

  it('should not return user_provided as an auth value', async () => {
    process.env.GOOGLE_KEY = AuthType.USER_PROVIDED;
    userLookup.mockResolvedValue(null);

    const result = await loadAuthValues({
      userId: 'user1',
      authFields: ['GOOGLE_KEY'],
      throwError: false,
    });

    expect(result).toEqual({});
  });

  it('should return env value without calling DB when env is valid', async () => {
    process.env.MY_KEY = 'valid-key';

    const result = await loadAuthValues({
      userId: 'user1',
      authFields: ['MY_KEY'],
    });

    expect(result).toEqual({ MY_KEY: 'valid-key' });
    expect(userLookup).not.toHaveBeenCalled();
  });

  it('should load independent authentication fields in parallel', async () => {
    delete process.env.FIRST_KEY;
    delete process.env.SECOND_KEY;
    let resolveFirst;
    const firstValue = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    userLookup.mockImplementation((_userId, field) => {
      if (field === 'FIRST_KEY') {
        return firstValue;
      }
      return Promise.resolve('second-value');
    });

    const resultPromise = loadAuthValues({
      userId: 'user1',
      authFields: ['FIRST_KEY', 'SECOND_KEY'],
    });
    await Promise.resolve();
    const callCountBeforeFirstResolved = userLookup.mock.calls.length;
    resolveFirst('first-value');

    await expect(resultPromise).resolves.toEqual({
      FIRST_KEY: 'first-value',
      SECOND_KEY: 'second-value',
    });
    expect(callCountBeforeFirstResolved).toBe(2);
  });

  it('should return real env value from first matching field in fallback chain', async () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GOOGLE_KEY = 'google-key';

    const result = await loadAuthValues({
      userId: 'user1',
      authFields: ['GEMINI_API_KEY||GOOGLE_KEY'],
    });

    expect(result).toEqual({ GEMINI_API_KEY: 'gemini-key' });
  });

  it('should return undefined for optional field when sentinel is filtered and DB throws', async () => {
    process.env.GOOGLE_KEY = AuthType.USER_PROVIDED;
    userLookup.mockRejectedValue(new Error('No auth found'));

    const optional = new Set(['GOOGLE_KEY']);
    const result = await loadAuthValues({
      userId: 'user1',
      authFields: ['GOOGLE_KEY'],
      optional,
    });

    expect(result).toEqual({ GOOGLE_KEY: undefined });
  });

  it('should distinguish a missing optional credential from a credential-store failure', async () => {
    delete process.env.KEENABLE_API_URL;
    const missingError = Object.assign(new Error('No auth found'), {
      code: 'PLUGIN_AUTH_NOT_FOUND',
    });
    userLookup.mockRejectedValueOnce(missingError);

    await expect(
      loadAuthValues({
        userId: 'user1',
        authFields: ['KEENABLE_API_URL'],
        optional: new Set(['KEENABLE_API_URL']),
        failOnOptionalError: true,
      }),
    ).resolves.toEqual({ KEENABLE_API_URL: undefined });

    userLookup.mockRejectedValueOnce(new Error('Database unavailable'));

    await expect(
      loadAuthValues({
        userId: 'user1',
        authFields: ['KEENABLE_API_URL'],
        optional: new Set(['KEENABLE_API_URL']),
        failOnOptionalError: true,
      }),
    ).rejects.toThrow('Database unavailable');
  });

  it('should not leak sentinel through catch path when DB lookup throws', async () => {
    process.env.GOOGLE_KEY = AuthType.USER_PROVIDED;
    userLookup.mockRejectedValue(new Error('No auth found'));

    await expect(
      loadAuthValues({
        userId: 'user1',
        authFields: ['GOOGLE_KEY'],
      }),
    ).rejects.toThrow('No auth found');
  });

  it('uses a key the administrator stored before the user own key', async () => {
    process.env.TAVILY_API_KEY = AuthType.USER_PROVIDED;
    systemKeys.set('TAVILY_API_KEY', 'org-key');

    const result = await loadAuthValues({ userId: 'user1', authFields: ['TAVILY_API_KEY'] });

    expect(result).toEqual({ TAVILY_API_KEY: 'org-key' });
    expect(userLookup).not.toHaveBeenCalled();
  });

  it('keeps the server environment ahead of a stored key', async () => {
    process.env.TAVILY_API_KEY = 'env-key';
    systemKeys.set('TAVILY_API_KEY', 'org-key');

    const result = await loadAuthValues({ userId: 'user1', authFields: ['TAVILY_API_KEY'] });

    expect(result).toEqual({ TAVILY_API_KEY: 'env-key' });
    expect(getUserPluginAuthValue).not.toHaveBeenCalled();
  });
});
