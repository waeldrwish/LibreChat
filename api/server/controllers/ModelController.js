const { logger } = require('@librechat/data-schemas');
const { getAppConfigOptionsFromUser } = require('@librechat/api');
const { loadDefaultModels, loadConfigModels, getAppConfig } = require('~/server/services/Config');
const { governance } = require('~/server/services/Governance');

const getModelsConfig = (req) => loadModels(req);

/** Every model the configured providers serve, before any admin model policy applies. */
async function loadAvailableModels(req) {
  const [defaultModelsConfig, customModelsConfig] = await Promise.all([
    loadDefaultModels(req),
    loadConfigModels(req),
  ]);
  return { ...defaultModelsConfig, ...customModelsConfig };
}

/** The models the requesting user may use: the provider catalog filtered by admin policies. */
async function loadModels(req) {
  const modelsConfig = await loadAvailableModels(req);
  const appConfig = req.config ?? (await getAppConfig(getAppConfigOptionsFromUser(req.user)));
  return governance.applyModelAccess({ user: req.user, appConfig, modelsConfig });
}

async function modelController(req, res) {
  try {
    const modelConfig = await loadModels(req);
    res.send(modelConfig);
  } catch (error) {
    logger.error('Error fetching models:', error);
    res.status(500).send({ error: error.message });
  }
}

module.exports = { modelController, loadModels, loadAvailableModels, getModelsConfig };
