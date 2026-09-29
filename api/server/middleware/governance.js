const {
  createUsageLimitGuard,
  createAdminAuditRecorder,
  createDisabledAgentGuard,
  getAppConfigOptionsFromUser,
} = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const { governance } = require('~/server/services/Governance');
const denyRequest = require('./denyRequest');
const db = require('~/models');

const recordAdminAction = createAdminAuditRecorder(db.recordAuditEntry);

const onExceeded = (req, exceeded) =>
  recordAdminAction(req, {
    action: 'usage.limit_exceeded',
    outcome: 'denied',
    severity: 'warning',
    target: {
      type: 'user',
      id: req.user.id ?? req.user._id?.toString(),
      name: req.user.email ?? req.user.name,
    },
    metadata: { metric: exceeded.metric, limit: exceeded.limit, used: exceeded.used },
  });

const resolveAppConfig = (req) => getAppConfig(getAppConfigOptionsFromUser(req.user));

/** Refuses new chat turns (as an in-stream error) once the user reached a usage limit. */
const chatUsageLimitGuard = createUsageLimitGuard({
  governance,
  getAppConfig: resolveAppConfig,
  onExceeded,
  skip: (req) => req.method !== 'POST' || req.path === '/resume',
  deny: (req, res, error) => denyRequest(req, res, error),
});

/** Refuses API (OpenAI-compatible / Responses) calls once the user reached a usage limit. */
const apiUsageLimitGuard = createUsageLimitGuard({
  governance,
  getAppConfig: resolveAppConfig,
  onExceeded,
  deny: (_req, res, error) =>
    res.status(429).json({
      error: {
        type: error.type,
        code: error.metric,
        message: `Usage limit reached (${error.metric}: ${error.used}/${error.limit}). Resets at ${error.resetAt}.`,
      },
    }),
});

/** Refuses chat turns that would run an agent an administrator disabled. */
const disabledAgentGuard = createDisabledAgentGuard({
  isAgentDisabled: db.isAgentDisabled,
  deny: (req, res, error) => denyRequest(req, res, error),
});

/** Refuses API calls whose `model` names an agent an administrator disabled. */
const apiDisabledAgentGuard = createDisabledAgentGuard({
  isAgentDisabled: db.isAgentDisabled,
  resolveAgentIds: (req) => (typeof req.body?.model === 'string' ? [req.body.model] : []),
  deny: (_req, res, error) =>
    res.status(403).json({
      error: { type: error.type, message: `Agent ${error.info} is disabled` },
    }),
});

module.exports = {
  chatUsageLimitGuard,
  apiUsageLimitGuard,
  disabledAgentGuard,
  apiDisabledAgentGuard,
};
