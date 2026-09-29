const { createGovernanceService } = require('@librechat/api');
const db = require('~/models');

/** Process-wide governance service: model access policies and usage limits. */
const governance = createGovernanceService({
  listModelPolicies: db.listModelPolicies,
  findUsageLimitsForPrincipals: db.findUsageLimitsForPrincipals,
  getUserUsageSnapshot: db.getUserUsageSnapshot,
  getUserPrincipals: db.getUserPrincipals,
});

/** `initializeAgent` dependency: the output-token cap an admin policy puts on a model. */
const getModelOutputCap = ({ endpoint, model, appConfig }) =>
  governance.getMaxOutputTokens({ endpoint, model, appConfig });

module.exports = { governance, getModelOutputCap };
