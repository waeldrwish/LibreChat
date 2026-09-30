const mockLoadDefaultModels = jest.fn();
const mockLoadConfigModels = jest.fn();
const mockGetAppConfig = jest.fn();
const mockGetEndpointsConfig = jest.fn();
const mockApplyModelAccess = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
  },
}));

jest.mock('@librechat/api', () => ({
  getAppConfigOptionsFromUser: (user) => ({ userId: user?.id, role: user?.role }),
  servedModels: (...args) => jest.requireActual('@librechat/api').servedModels(...args),
}));

jest.mock('~/server/services/Config', () => ({
  loadDefaultModels: (...args) => mockLoadDefaultModels(...args),
  loadConfigModels: (...args) => mockLoadConfigModels(...args),
  getAppConfig: (...args) => mockGetAppConfig(...args),
  getEndpointsConfig: (...args) => mockGetEndpointsConfig(...args),
}));

jest.mock('~/server/services/Governance', () => ({
  governance: {
    applyModelAccess: (...args) => mockApplyModelAccess(...args),
  },
}));

const { loadModels, loadServedModels, loadAvailableModels } = require('./ModelController');

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('loadModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApplyModelAccess.mockImplementation(async ({ modelsConfig }) => modelsConfig);
    mockGetAppConfig.mockResolvedValue({});
  });

  it('loads default and configured models concurrently while preserving custom precedence', async () => {
    const defaultModels = deferred();
    const configuredModels = deferred();
    const req = { user: { id: 'user-1' } };
    mockLoadDefaultModels.mockReturnValue(defaultModels.promise);
    mockLoadConfigModels.mockReturnValue(configuredModels.promise);

    const resultPromise = loadModels(req);

    expect(mockLoadDefaultModels).toHaveBeenCalledWith(req);
    expect(mockLoadConfigModels).toHaveBeenCalledWith(req);

    configuredModels.resolve({
      openAI: ['configured-model'],
      custom: ['custom-model'],
    });
    defaultModels.resolve({
      openAI: ['default-model'],
      anthropic: ['default-anthropic'],
    });

    await expect(resultPromise).resolves.toEqual({
      openAI: ['configured-model'],
      anthropic: ['default-anthropic'],
      custom: ['custom-model'],
    });
  });

  it("filters the catalog through the user's model access policies", async () => {
    const req = { user: { id: 'user-1', role: 'USER' }, config: { governance: {} } };
    mockLoadDefaultModels.mockResolvedValue({ openAI: ['gpt-4o', 'gpt-4o-mini'] });
    mockLoadConfigModels.mockResolvedValue({});
    mockApplyModelAccess.mockImplementation(async ({ modelsConfig }) => ({
      openAI: modelsConfig.openAI.filter((model) => model !== 'gpt-4o'),
    }));

    await expect(loadModels(req)).resolves.toEqual({ openAI: ['gpt-4o-mini'] });
    expect(mockApplyModelAccess).toHaveBeenCalledWith({
      user: req.user,
      appConfig: req.config,
      modelsConfig: { openAI: ['gpt-4o', 'gpt-4o-mini'] },
    });
    expect(mockGetAppConfig).not.toHaveBeenCalled();
  });

  it('resolves the user config when the request has none', async () => {
    const req = { user: { id: 'user-2', role: 'USER' } };
    mockLoadDefaultModels.mockResolvedValue({});
    mockLoadConfigModels.mockResolvedValue({});
    mockGetAppConfig.mockResolvedValue({ governance: { models: { defaultPolicy: 'deny' } } });

    await loadModels(req);

    expect(mockGetAppConfig).toHaveBeenCalledWith({ userId: 'user-2', role: 'USER' });
    expect(mockApplyModelAccess).toHaveBeenCalledWith(
      expect.objectContaining({ appConfig: { governance: { models: { defaultPolicy: 'deny' } } } }),
    );
  });

  it('keeps the unfiltered catalog available to administrators', async () => {
    const req = { user: { id: 'admin-1' } };
    mockLoadDefaultModels.mockResolvedValue({ openAI: ['gpt-4o'] });
    mockLoadConfigModels.mockResolvedValue({});

    await expect(loadAvailableModels(req)).resolves.toEqual({ openAI: ['gpt-4o'] });
    expect(mockApplyModelAccess).not.toHaveBeenCalled();
  });
});

describe('loadServedModels', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps only the providers the endpoints config enables', async () => {
    const req = { user: { id: 'admin-1' } };
    mockLoadDefaultModels.mockResolvedValue({ openAI: ['gpt-4o'], anthropic: ['claude'] });
    mockLoadConfigModels.mockResolvedValue({ 'OpenAI API': ['gpt-4o'] });
    mockGetEndpointsConfig.mockResolvedValue({ agents: {}, 'OpenAI API': { type: 'custom' } });

    await expect(loadServedModels(req)).resolves.toEqual({ 'OpenAI API': ['gpt-4o'] });
    expect(mockGetEndpointsConfig).toHaveBeenCalledWith(req);
  });
});
