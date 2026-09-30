import { z } from 'zod';
import { logger, SystemCapabilities, BASE_CONFIG_PRINCIPAL_ID } from '@librechat/data-schemas';
import {
  ANY_MODEL,
  PrincipalType,
  EModelEndpoint,
  PrincipalModel,
  MODEL_GRANT_EFFECTS,
  MODEL_POLICY_ACCESS,
  MODEL_GRANT_PRINCIPALS,
  isReservedEndpointName,
  resolveGovernanceConfig,
} from 'librechat-data-provider';
import type {
  TProviders,
  TModelPolicy,
  TModelCatalog,
  TModelsConfig,
  TManagedProvider,
  TEndpointsConfig,
  TModelCatalogEntry,
  TConfiguredProvider,
} from 'librechat-data-provider';
import type {
  IConfig,
  AppConfig,
  SystemCapability,
  ModelPolicyWrite,
  ModelPolicyRecord,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminAuditRecorder, AdminHandler } from './trail';
import type { ServerRequest } from '~/types/http';
import type { CapabilityUser } from './scope';
import {
  encryptConfigSecrets,
  redactConfigSecrets,
  preserveConfigSecrets,
  getConfigSecretInputError,
} from './secrets';
import { resolveAdminActor } from './trail';
import { toCapabilityUser } from './scope';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const AGENT_ID = /^agent_[\w-]{1,200}$/;
const CUSTOM_PATH = 'endpoints.custom';

const grantSchema = z
  .object({
    principalType: z.enum(MODEL_GRANT_PRINCIPALS),
    principalId: z.string().min(1).max(256),
    effect: z.enum(MODEL_GRANT_EFFECTS),
  })
  .refine(
    (grant) => {
      if (grant.principalType === 'user' || grant.principalType === 'group') {
        return OBJECT_ID.test(grant.principalId);
      }
      if (grant.principalType === 'agent') {
        return AGENT_ID.test(grant.principalId) && grant.effect === 'allow';
      }
      return true;
    },
    { message: 'Invalid grant principal' },
  );

const policyFields = {
  label: z.string().trim().max(256).optional(),
  description: z.string().max(2000).optional(),
  enabled: z.boolean(),
  access: z.enum(MODEL_POLICY_ACCESS),
  maxOutputTokens: z.number().int().positive().max(10_000_000).nullable().optional(),
  grants: z.array(grantSchema).max(1000),
};

const createPolicySchema = z.object({
  endpoint: z.string().trim().min(1).max(256),
  model: z.string().trim().min(1).max(256),
  ...policyFields,
  enabled: policyFields.enabled.default(true),
  access: policyFields.access.default('inherit'),
  grants: policyFields.grants.default([]),
});

const updatePolicySchema = z.object(policyFields).partial();

const providerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((name) => !isReservedEndpointName(name), {
      message: 'Reserved endpoint name',
    }),
  baseURL: z.string().trim().min(1).max(2048),
  apiKey: z.string().max(4096).optional(),
  models: z.object({
    default: z.array(z.string().trim().min(1).max(256)).max(500),
    fetch: z.boolean().optional(),
  }),
  titleConvo: z.boolean().optional(),
  titleModel: z.string().trim().max(256).optional(),
  modelDisplayLabel: z.string().trim().max(128).optional(),
  iconURL: z.string().trim().max(2048).optional(),
});

const providersSchema = z
  .array(providerSchema)
  .max(100)
  .refine(
    (providers) =>
      new Set(providers.map((provider) => provider.name.toLowerCase())).size === providers.length,
    { message: 'Provider names must be unique' },
  );

type PolicyBody = z.infer<typeof createPolicySchema>;

export interface AdminModelsDeps {
  /** The catalog of enabled providers, before any policy filter. */
  loadAvailableModels: (req: ServerRequest) => Promise<TModelsConfig>;
  getEndpointsConfig: (req: ServerRequest) => Promise<TEndpointsConfig>;
  /** The tenant-wide config (YAML merged with the base DB override). */
  getTenantConfig: (tenantId?: string) => Promise<AppConfig>;
  /** The YAML-derived config only. */
  getYamlConfig: () => Promise<AppConfig>;
  listModelPolicies: () => Promise<ModelPolicyRecord[]>;
  findModelPolicyById: (id: string) => Promise<ModelPolicyRecord | null>;
  createModelPolicy: (policy: ModelPolicyWrite) => Promise<ModelPolicyRecord>;
  updateModelPolicy: (
    id: string,
    policy: Partial<ModelPolicyWrite>,
  ) => Promise<ModelPolicyRecord | null>;
  deleteModelPolicy: (id: string) => Promise<ModelPolicyRecord | null>;
  findConfigByPrincipal: (
    principalType: PrincipalType,
    principalId: string,
    options?: { includeInactive?: boolean },
  ) => Promise<IConfig | null>;
  upsertConfig: (
    principalType: PrincipalType,
    principalId: string,
    principalModel: PrincipalModel,
    overrides: Record<string, unknown>,
    priority: number,
    session?: undefined,
    options?: { expectEmpty?: boolean; preservePriority?: boolean },
  ) => Promise<IConfig | null>;
  hasCapability: (user: CapabilityUser, capability: SystemCapability) => Promise<boolean>;
  invalidateConfigCaches?: (tenantId?: string) => Promise<unknown>;
  invalidateGovernance: () => void;
  recordAdminAction: AdminAuditRecorder;
}

export function toModelPolicy(record: ModelPolicyRecord): TModelPolicy {
  return {
    id: record._id,
    endpoint: record.endpoint,
    model: record.model,
    label: record.label,
    description: record.description,
    enabled: record.enabled,
    access: record.access,
    maxOutputTokens: record.maxOutputTokens,
    grants: record.grants,
    createdAt: record.createdAt?.toISOString(),
    updatedAt: record.updatedAt?.toISOString(),
  };
}

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

type Body = Record<string, unknown>;

function asRecord(value: unknown): Body {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Body) : {};
}

function toManagedProvider(entry: unknown): TManagedProvider | null {
  const record = asRecord(entry);
  if (typeof record.name !== 'string') {
    return null;
  }
  const models = asRecord(record.models);
  return {
    name: record.name,
    baseURL: typeof record.baseURL === 'string' ? record.baseURL : '',
    apiKeyPreview: typeof record.apiKeyPreview === 'string' ? record.apiKeyPreview : undefined,
    apiKey:
      typeof record.apiKey === 'string' && !record.apiKey.startsWith('v3:')
        ? record.apiKey
        : undefined,
    models: {
      default: Array.isArray(models.default)
        ? models.default.filter((model): model is string => typeof model === 'string')
        : [],
      fetch: models.fetch === true,
    },
    titleConvo: record.titleConvo === true ? true : undefined,
    titleModel: typeof record.titleModel === 'string' ? record.titleModel : undefined,
    modelDisplayLabel:
      typeof record.modelDisplayLabel === 'string' ? record.modelDisplayLabel : undefined,
    iconURL: typeof record.iconURL === 'string' ? record.iconURL : undefined,
  };
}

/** Model catalog, model policies and admin-managed custom providers. */
export function createAdminModelsHandlers(
  deps: AdminModelsDeps,
): Record<
  | 'catalog'
  | 'createPolicy'
  | 'updatePolicy'
  | 'deletePolicy'
  | 'listProviders'
  | 'updateProviders',
  AdminHandler
> {
  async function catalog(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const [available, policies, appConfig] = await Promise.all([
        deps.loadAvailableModels(req),
        deps.listModelPolicies(),
        deps.getTenantConfig(actor.tenantId),
      ]);
      const policyByKey = new Map<string, ModelPolicyRecord>();
      const endpointPolicies: TModelPolicy[] = [];
      for (const policy of policies) {
        if (policy.model === ANY_MODEL) {
          endpointPolicies.push(toModelPolicy(policy));
        } else {
          policyByKey.set(`${policy.endpoint}|${policy.model}`, policy);
        }
      }

      const entries: TModelCatalogEntry[] = [];
      const seen = new Set<string>();
      for (const [endpoint, models] of Object.entries(available)) {
        if (!Array.isArray(models)) {
          continue;
        }
        for (const model of models) {
          const key = `${endpoint}|${model}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          const policy = policyByKey.get(key);
          entries.push({
            endpoint,
            model,
            available: true,
            ...(policy ? { policy: toModelPolicy(policy) } : {}),
          });
        }
      }
      for (const [key, policy] of policyByKey) {
        if (!seen.has(key)) {
          entries.push({
            endpoint: policy.endpoint,
            model: policy.model,
            available: false,
            policy: toModelPolicy(policy),
          });
        }
      }

      const body: TModelCatalog = {
        defaultPolicy: resolveGovernanceConfig(appConfig?.governance).models.defaultPolicy,
        endpoints: Object.keys(available),
        entries,
        endpointPolicies,
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminModels] catalog error:', error);
      return res.status(500).json({ error: 'Failed to load model catalog' });
    }
  }

  function policyWrite(body: Partial<PolicyBody>, actorId: string): Partial<ModelPolicyWrite> {
    const write: Partial<ModelPolicyWrite> = { updatedBy: actorId };
    if (body.endpoint !== undefined) write.endpoint = body.endpoint;
    if (body.model !== undefined) write.model = body.model;
    if (body.label !== undefined) write.label = body.label;
    if (body.description !== undefined) write.description = body.description;
    if (body.enabled !== undefined) write.enabled = body.enabled;
    if (body.access !== undefined) write.access = body.access;
    if (body.maxOutputTokens !== undefined) {
      write.maxOutputTokens = body.maxOutputTokens ?? undefined;
    }
    if (body.grants !== undefined) write.grants = body.grants;
    return write;
  }

  async function createPolicy(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const parsed = createPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid policy' });
      }
      const created = await deps.createModelPolicy({
        ...(policyWrite(parsed.data, actor.userId) as ModelPolicyWrite),
        createdBy: actor.userId,
      });
      deps.invalidateGovernance();
      await deps.recordAdminAction(req, {
        action: 'model.policy_created',
        target: { type: 'model', id: created._id, name: `${created.endpoint}|${created.model}` },
        metadata: {
          enabled: created.enabled,
          access: created.access,
          grants: created.grants.length,
        },
      });
      return res.status(201).json({ policy: toModelPolicy(created) });
    } catch (error) {
      if (isDuplicateKey(error)) {
        return res.status(409).json({ error: 'A policy for this model already exists' });
      }
      logger.error('[adminModels] createPolicy error:', error);
      return res.status(500).json({ error: 'Failed to create model policy' });
    }
  }

  async function updatePolicy(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { id } = req.params as { id: string };
      const parsed = updatePolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid policy' });
      }
      const updated = await deps.updateModelPolicy(id, policyWrite(parsed.data, actor.userId));
      if (!updated) {
        return res.status(404).json({ error: 'Model policy not found' });
      }
      deps.invalidateGovernance();
      await deps.recordAdminAction(req, {
        action: 'model.policy_updated',
        target: { type: 'model', id: updated._id, name: `${updated.endpoint}|${updated.model}` },
        metadata: {
          fields: Object.keys(parsed.data).sort().join(','),
          enabled: updated.enabled,
          access: updated.access,
          grants: updated.grants.length,
        },
      });
      return res.status(200).json({ policy: toModelPolicy(updated) });
    } catch (error) {
      logger.error('[adminModels] updatePolicy error:', error);
      return res.status(500).json({ error: 'Failed to update model policy' });
    }
  }

  async function deletePolicy(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params as { id: string };
      const deleted = await deps.deleteModelPolicy(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Model policy not found' });
      }
      deps.invalidateGovernance();
      await deps.recordAdminAction(req, {
        action: 'model.policy_deleted',
        severity: 'warning',
        target: { type: 'model', id: deleted._id, name: `${deleted.endpoint}|${deleted.model}` },
      });
      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[adminModels] deletePolicy error:', error);
      return res.status(500).json({ error: 'Failed to delete model policy' });
    }
  }

  async function listProviders(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const [endpointsConfig, available, yamlConfig, baseDoc, canManage] = await Promise.all([
        deps.getEndpointsConfig(req),
        deps.loadAvailableModels(req).catch((): TModelsConfig => ({})),
        deps.getYamlConfig(),
        deps.findConfigByPrincipal(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID, {
          includeInactive: true,
        }),
        deps.hasCapability(toCapabilityUser(actor), SystemCapabilities.MANAGE_CONFIGS),
      ]);

      const configuredEntries = Array.isArray(yamlConfig?.endpoints?.custom)
        ? yamlConfig.endpoints.custom
        : [];
      const configured: TConfiguredProvider[] = configuredEntries
        .filter((entry) => typeof entry?.name === 'string')
        .map((entry) => ({
          name: entry.name as string,
          baseURL: typeof entry.baseURL === 'string' ? entry.baseURL : undefined,
          models: available[entry.name as string]?.length ?? 0,
          fetch: entry.models?.fetch === true,
        }));
      const configuredNames = new Set(configured.map((provider) => provider.name));

      const builtIn = Object.values(EModelEndpoint)
        .filter(
          (name) =>
            name !== EModelEndpoint.custom &&
            name !== EModelEndpoint.agents &&
            !configuredNames.has(name),
        )
        .map((name) => ({
          name,
          enabled: endpointsConfig?.[name] != null,
          userProvide: endpointsConfig?.[name]?.userProvide === true,
          models: available[name]?.length ?? 0,
        }));

      const redacted = redactConfigSecrets(structuredClone(asRecord(baseDoc?.overrides)));
      const managedEntries = asRecord(asRecord(redacted).endpoints).custom;
      const managed = (Array.isArray(managedEntries) ? managedEntries : [])
        .map(toManagedProvider)
        .filter((provider): provider is TManagedProvider => provider != null);

      const body: TProviders = { builtIn, configured, managed, canManage };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminModels] listProviders error:', error);
      return res.status(500).json({ error: 'Failed to load providers' });
    }
  }

  /**
   * Replaces the admin-managed custom providers stored in the base config override.
   * An entry that omits `apiKey` keeps the key stored under the same name.
   */
  async function updateProviders(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const actor = resolveAdminActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const parsed = providersSchema.safeParse((req.body as Body | undefined)?.providers);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors[0]?.message ?? 'Invalid providers' });
      }
      const providers = parsed.data.map((provider) => {
        const { apiKey, ...rest } = provider;
        return apiKey === undefined ? rest : { ...rest, apiKey };
      });
      const inputError = getConfigSecretInputError(CUSTOM_PATH, providers);
      if (inputError) {
        return res.status(400).json({ error: inputError });
      }
      const yamlConfig = await deps.getYamlConfig();
      const yamlNames = new Set(
        (Array.isArray(yamlConfig?.endpoints?.custom) ? yamlConfig.endpoints.custom : [])
          .map((entry) => (typeof entry?.name === 'string' ? entry.name.toLowerCase() : ''))
          .filter(Boolean),
      );
      const collision = providers.find((provider) => yamlNames.has(provider.name.toLowerCase()));
      if (collision) {
        return res
          .status(409)
          .json({ error: `"${collision.name}" is already defined in librechat.yaml` });
      }

      const existing = await deps.findConfigByPrincipal(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        { includeInactive: true },
      );
      const existingOverrides = asRecord(existing?.overrides);
      const encrypted = encryptConfigSecrets(providers, CUSTOM_PATH);
      const preserved = preserveConfigSecrets(encrypted, existingOverrides, CUSTOM_PATH);
      const endpoints = { ...asRecord(existingOverrides.endpoints), custom: preserved };
      await deps.upsertConfig(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        { ...existingOverrides, endpoints },
        existing?.priority ?? 0,
        undefined,
        { expectEmpty: false },
      );
      await deps
        .invalidateConfigCaches?.(actor.tenantId)
        ?.catch((error: unknown) =>
          logger.error('[adminModels] Config cache invalidation failed:', error),
        );
      await deps.recordAdminAction(req, {
        action: 'config.updated',
        severity: 'warning',
        target: { type: 'config', id: CUSTOM_PATH, name: 'providers' },
        metadata: { providers: providers.map((provider) => provider.name).join(',') },
      });
      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[adminModels] updateProviders error:', error);
      return res.status(500).json({ error: 'Failed to update providers' });
    }
  }

  return { catalog, createPolicy, updatePolicy, deletePolicy, listProviders, updateProviders };
}
