import { ANY_MODEL, modelKey, isEphemeralAgentId } from 'librechat-data-provider';
import type {
  TModelGrant,
  TModelsConfig,
  TEndpointsConfig,
  TAccessSource,
  ModelAccessPolicy,
} from 'librechat-data-provider';
import type { ModelPolicyRecord } from '@librechat/data-schemas';
import type { PrincipalSet } from './principals';

export type ModelPolicyIndex = {
  /** `endpoint|model` → model-specific policy. */
  byModel: Map<string, ModelPolicyRecord>;
  /** `endpoint` → endpoint-wide (`model: '*'`) policy. */
  byEndpoint: Map<string, ModelPolicyRecord>;
  size: number;
};

export type ModelDecision = { allowed: boolean; source: TAccessSource };

export function indexModelPolicies(policies: ModelPolicyRecord[]): ModelPolicyIndex {
  const byModel = new Map<string, ModelPolicyRecord>();
  const byEndpoint = new Map<string, ModelPolicyRecord>();
  for (const policy of policies) {
    if (policy.model === ANY_MODEL) {
      byEndpoint.set(policy.endpoint, policy);
    } else {
      byModel.set(modelKey(policy.endpoint, policy.model), policy);
    }
  }
  return { byModel, byEndpoint, size: policies.length };
}

type Level = 'user' | 'group' | 'role';

function grantsAtLevel(
  policy: ModelPolicyRecord | undefined,
  level: Level,
  principals: PrincipalSet,
): TModelGrant[] {
  if (!policy) {
    return [];
  }
  return policy.grants.filter((grant) => {
    if (grant.principalType !== level) {
      return false;
    }
    if (level === 'user') {
      return grant.principalId === principals.userId;
    }
    if (level === 'group') {
      return principals.groupIds.includes(grant.principalId);
    }
    return grant.principalId === principals.role;
  });
}

/** Within one level an explicit deny beats any allow. */
const decideGrants = (grants: TModelGrant[]) => !grants.some((grant) => grant.effect === 'deny');

const LEVELS: Level[] = ['user', 'group', 'role'];

/**
 * Decides whether a principal may use `endpoint`/`model`.
 *
 * 1. A disabled model policy, or a disabled endpoint-wide policy, denies everyone.
 * 2. Grants are read by principal precedence — user, then group, then role — and the
 *    first level with a matching grant decides; at each level the model-specific
 *    policy is read before the endpoint-wide one, and a deny beats an allow.
 * 3. Otherwise the policy's `access` decides (`inherit` defers to the endpoint-wide
 *    policy, then to `defaultPolicy`).
 */
export function decideModelAccess(
  index: ModelPolicyIndex,
  principals: PrincipalSet,
  endpoint: string,
  model: string,
  defaultPolicy: ModelAccessPolicy,
): ModelDecision {
  const specific = index.byModel.get(modelKey(endpoint, model));
  const wide = index.byEndpoint.get(endpoint);

  if (specific?.enabled === false || wide?.enabled === false) {
    return { allowed: false, source: 'policy' };
  }

  for (const level of LEVELS) {
    const specificGrants = grantsAtLevel(specific, level, principals);
    if (specificGrants.length > 0) {
      return { allowed: decideGrants(specificGrants), source: level };
    }
    const wideGrants = grantsAtLevel(wide, level, principals);
    if (wideGrants.length > 0) {
      return { allowed: decideGrants(wideGrants), source: level };
    }
  }

  for (const policy of [specific, wide]) {
    if (policy && policy.access !== 'inherit') {
      return { allowed: policy.access === 'all', source: 'policy' };
    }
  }

  return { allowed: defaultPolicy === 'allow', source: 'default' };
}

/** Whether an admin granted this model to an agent, so the agent's users may run it through the agent. */
export function isModelDelegatedToAgent(
  index: ModelPolicyIndex,
  agentId: string,
  endpoint: string,
  model: string,
): boolean {
  if (!agentId || isEphemeralAgentId(agentId)) {
    return false;
  }
  const specific = index.byModel.get(modelKey(endpoint, model));
  const wide = index.byEndpoint.get(endpoint);
  if (specific?.enabled === false || wide?.enabled === false) {
    return false;
  }
  const grantsAgent = (policy?: ModelPolicyRecord) =>
    policy?.grants.some(
      (grant) =>
        grant.principalType === 'agent' &&
        grant.principalId === agentId &&
        grant.effect === 'allow',
    ) === true;
  return grantsAgent(specific) || grantsAgent(wide);
}

/** Output-token parameter each provider family reads from `model_parameters`. */
const OUTPUT_TOKEN_KEY: Record<string, string> = {
  anthropic: 'maxOutputTokens',
  google: 'maxOutputTokens',
  vertexai: 'maxOutputTokens',
  bedrock: 'maxTokens',
};
const OUTPUT_TOKEN_KEYS = ['max_tokens', 'maxOutputTokens', 'maxTokens'];

/**
 * Enforces an administrator's output-token cap on request model parameters: lowers
 * any requested value above the cap and sets the provider's parameter when none was
 * requested. Applied before the provider client is configured, so provider-specific
 * translations (e.g. reasoning models' completion-token field) still happen.
 */
export function capOutputTokens(
  modelParameters: Record<string, unknown>,
  cap: number,
  provider: string,
): void {
  let present = false;
  for (const key of OUTPUT_TOKEN_KEYS) {
    const value = modelParameters[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      present = true;
      modelParameters[key] = Math.min(value, cap);
    }
  }
  if (!present) {
    modelParameters[OUTPUT_TOKEN_KEY[provider] ?? 'max_tokens'] = cap;
  }
}

/**
 * Carried (non-enumerably, so it never reaches a response body) on a filtered models
 * config: lets agent model validation admit a model the user cannot pick directly but
 * that an administrator delegated to the agent being run.
 */
const MODEL_ACCESS_CONTEXT = Symbol.for('librechat.governance.modelAccess');

type ModelAccessContext = {
  index: ModelPolicyIndex;
  /** The provider catalog before the user's policy filter. */
  available: TModelsConfig;
};

type ModelsConfigWithAccess = TModelsConfig & { [MODEL_ACCESS_CONTEXT]?: ModelAccessContext };

/**
 * Keeps the providers the endpoints config enables. A built-in provider with no key, or one
 * left out of `ENDPOINTS`, still lists default models that nobody can reach.
 */
export function servedModels(
  modelsConfig: TModelsConfig,
  endpointsConfig: TEndpointsConfig,
): TModelsConfig {
  const served: TModelsConfig = {};
  for (const [endpoint, models] of Object.entries(modelsConfig)) {
    if (endpointsConfig?.[endpoint]) {
      served[endpoint] = models;
    }
  }
  return served;
}

/** Removes the models `isAllowed` rejects, keeping the unfiltered catalog for agent delegation. */
export function filterModelsConfig(
  modelsConfig: TModelsConfig,
  index: ModelPolicyIndex,
  isAllowed: (endpoint: string, model: string) => boolean,
): TModelsConfig {
  const filtered: TModelsConfig = {};
  for (const [endpoint, models] of Object.entries(modelsConfig)) {
    filtered[endpoint] = Array.isArray(models)
      ? models.filter((model) => isAllowed(endpoint, model))
      : models;
  }
  Object.defineProperty(filtered, MODEL_ACCESS_CONTEXT, {
    value: { index, available: modelsConfig } satisfies ModelAccessContext,
    enumerable: false,
  });
  return filtered;
}

/**
 * Admits an agent's model that the user's filtered catalog omits when an
 * administrator delegated it to that agent and a provider still serves it.
 */
export function isAgentModelDelegated(
  modelsConfig: TModelsConfig | null | undefined,
  agent: { id?: string; provider?: string; model?: string | null },
  catalogKey: string,
): boolean {
  const context = (modelsConfig as ModelsConfigWithAccess | null | undefined)?.[
    MODEL_ACCESS_CONTEXT
  ];
  if (!context || !agent.id || !agent.provider || !agent.model) {
    return false;
  }
  const available = context.available[catalogKey];
  if (!Array.isArray(available) || !available.includes(agent.model)) {
    return false;
  }
  return isModelDelegatedToAgent(context.index, agent.id, catalogKey, agent.model);
}
