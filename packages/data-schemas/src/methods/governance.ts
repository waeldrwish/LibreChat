import { ANY_MODEL, parseModelKey } from 'librechat-data-provider';
import type { TUsageLimits, TModelGrant, AccessPrincipalType } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type {
  IUsageLimit,
  IModelPolicy,
  ModelPolicyWrite,
  UsageLimitRecord,
  ModelPolicyRecord,
  UsagePrincipalRef,
} from '~/types';

type LeanPolicy = Omit<ModelPolicyRecord, '_id'> & { _id: { toString(): string } };
type LeanLimit = UsageLimitRecord & { _id: unknown };

function toPolicyRecord(doc: LeanPolicy): ModelPolicyRecord {
  return {
    _id: doc._id.toString(),
    endpoint: doc.endpoint,
    model: doc.model,
    label: doc.label,
    description: doc.description,
    enabled: doc.enabled !== false,
    access: doc.access ?? 'inherit',
    maxOutputTokens: doc.maxOutputTokens,
    grants: (doc.grants ?? []).map((grant) => ({
      principalType: grant.principalType,
      principalId: grant.principalId,
      effect: grant.effect,
    })),
    createdBy: doc.createdBy,
    updatedBy: doc.updatedBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toLimitRecord(doc: LeanLimit): UsageLimitRecord {
  return {
    principalType: doc.principalType,
    principalId: doc.principalId,
    limits: doc.limits ?? {},
    updatedBy: doc.updatedBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Drops unset metrics so a stored limit document only carries explicit values. */
function compactLimits(limits: TUsageLimits): TUsageLimits {
  const compact: TUsageLimits = {};
  for (const [metric, value] of Object.entries(limits) as [keyof TUsageLimits, unknown][]) {
    if (typeof value === 'number' && Number.isInteger(value)) {
      compact[metric] = value;
    }
  }
  return compact;
}

/** Governance storage: admin model policies and principal usage limits. */
export function createGovernanceMethods(mongoose: typeof import('mongoose')): {
  listModelPolicies: () => Promise<ModelPolicyRecord[]>;
  findModelPolicyById: (id: string) => Promise<ModelPolicyRecord | null>;
  createModelPolicy: (policy: ModelPolicyWrite) => Promise<ModelPolicyRecord>;
  updateModelPolicy: (
    id: string,
    policy: Partial<ModelPolicyWrite>,
  ) => Promise<ModelPolicyRecord | null>;
  deleteModelPolicy: (id: string) => Promise<ModelPolicyRecord | null>;
  setPrincipalModelGrants: (params: {
    principal: UsagePrincipalRef;
    allowedModels: string[];
    deniedModels: string[];
    updatedBy?: string;
  }) => Promise<void>;
  removePrincipalFromModelGrants: (principal: {
    principalType: TModelGrant['principalType'];
    principalId: string;
  }) => Promise<void>;
  listUsageLimits: (principalType?: AccessPrincipalType) => Promise<UsageLimitRecord[]>;
  findUsageLimitsForPrincipals: (principals: UsagePrincipalRef[]) => Promise<UsageLimitRecord[]>;
  setUsageLimits: (params: {
    principal: UsagePrincipalRef;
    limits: TUsageLimits;
    updatedBy?: string;
  }) => Promise<UsageLimitRecord | null>;
  deleteUsageLimits: (principal: UsagePrincipalRef) => Promise<boolean>;
  deletePrincipalGovernance: (
    principalType: AccessPrincipalType,
    principalId: string,
  ) => Promise<void>;
} {
  const policies = (): Model<IModelPolicy> => mongoose.models.ModelPolicy as Model<IModelPolicy>;
  const limitsModel = (): Model<IUsageLimit> => mongoose.models.UsageLimit as Model<IUsageLimit>;
  const isObjectId = (id: string) => mongoose.isValidObjectId(id);

  async function listModelPolicies(): Promise<ModelPolicyRecord[]> {
    const docs = await policies().find({}).sort({ endpoint: 1, model: 1 }).lean<LeanPolicy[]>();
    return docs.map(toPolicyRecord);
  }

  async function findModelPolicyById(id: string): Promise<ModelPolicyRecord | null> {
    if (!isObjectId(id)) {
      return null;
    }
    const doc = await policies().findById(id).lean<LeanPolicy>();
    return doc ? toPolicyRecord(doc) : null;
  }

  async function createModelPolicy(policy: ModelPolicyWrite): Promise<ModelPolicyRecord> {
    const doc = await policies().create(policy);
    return toPolicyRecord(doc.toObject() as unknown as LeanPolicy);
  }

  async function updateModelPolicy(
    id: string,
    policy: Partial<ModelPolicyWrite>,
  ): Promise<ModelPolicyRecord | null> {
    if (!isObjectId(id)) {
      return null;
    }
    const doc = await policies()
      .findByIdAndUpdate(id, { $set: policy }, { new: true, runValidators: true })
      .lean<LeanPolicy>();
    return doc ? toPolicyRecord(doc) : null;
  }

  async function deleteModelPolicy(id: string): Promise<ModelPolicyRecord | null> {
    if (!isObjectId(id)) {
      return null;
    }
    const doc = await policies().findByIdAndDelete(id).lean<LeanPolicy>();
    return doc ? toPolicyRecord(doc) : null;
  }

  async function removePrincipalFromModelGrants(principal: {
    principalType: TModelGrant['principalType'];
    principalId: string;
  }): Promise<void> {
    await policies().updateMany(
      {
        grants: {
          $elemMatch: {
            principalType: principal.principalType,
            principalId: principal.principalId,
          },
        },
      },
      {
        $pull: {
          grants: { principalType: principal.principalType, principalId: principal.principalId },
        },
      },
    );
  }

  /**
   * Replaces one principal's explicit model grants: the principal ends up allowed
   * on exactly `allowedModels` and denied on exactly `deniedModels` (both
   * `endpoint|model` keys). A model without a policy gets an `inherit` one so the
   * grant has somewhere to live without changing anyone else's access.
   */
  async function setPrincipalModelGrants({
    principal,
    allowedModels,
    deniedModels,
    updatedBy,
  }: {
    principal: UsagePrincipalRef;
    allowedModels: string[];
    deniedModels: string[];
    updatedBy?: string;
  }): Promise<void> {
    const effects = new Map<string, TModelGrant['effect']>();
    for (const key of allowedModels) {
      effects.set(key, 'allow');
    }
    for (const key of deniedModels) {
      effects.set(key, 'deny');
    }

    await removePrincipalFromModelGrants(principal);
    if (effects.size === 0) {
      return;
    }

    const writes: Promise<unknown>[] = [];
    for (const [key, effect] of effects) {
      const parsed = parseModelKey(key);
      if (!parsed) {
        continue;
      }
      const grant: TModelGrant = {
        principalType: principal.principalType,
        principalId: principal.principalId,
        effect,
      };
      writes.push(
        policies().updateOne(
          { endpoint: parsed.endpoint, model: parsed.model },
          {
            $push: { grants: grant },
            $setOnInsert: {
              enabled: true,
              access: 'inherit',
              ...(updatedBy ? { createdBy: updatedBy } : {}),
            },
            ...(updatedBy ? { $set: { updatedBy } } : {}),
          },
          { upsert: true },
        ),
      );
    }
    await Promise.all(writes);
  }

  async function listUsageLimits(principalType?: AccessPrincipalType): Promise<UsageLimitRecord[]> {
    const docs = await limitsModel()
      .find(principalType ? { principalType } : {})
      .sort({ principalType: 1, updatedAt: -1 })
      .lean<LeanLimit[]>();
    return docs.map(toLimitRecord);
  }

  async function findUsageLimitsForPrincipals(
    principals: UsagePrincipalRef[],
  ): Promise<UsageLimitRecord[]> {
    if (principals.length === 0) {
      return [];
    }
    const docs = await limitsModel()
      .find({
        $or: principals.map((p) => ({
          principalType: p.principalType,
          principalId: p.principalId,
        })),
      })
      .lean<LeanLimit[]>();
    return docs.map(toLimitRecord);
  }

  async function setUsageLimits({
    principal,
    limits,
    updatedBy,
  }: {
    principal: UsagePrincipalRef;
    limits: TUsageLimits;
    updatedBy?: string;
  }): Promise<UsageLimitRecord | null> {
    const compact = compactLimits(limits);
    if (Object.keys(compact).length === 0) {
      await deleteUsageLimits(principal);
      return null;
    }
    const doc = await limitsModel()
      .findOneAndUpdate(
        { principalType: principal.principalType, principalId: principal.principalId },
        {
          $set: { limits: compact, ...(updatedBy ? { updatedBy } : {}) },
          $setOnInsert: {
            principalType: principal.principalType,
            principalId: principal.principalId,
          },
        },
        { new: true, upsert: true, runValidators: true },
      )
      .lean<LeanLimit>();
    return doc ? toLimitRecord(doc) : null;
  }

  async function deleteUsageLimits(principal: UsagePrincipalRef): Promise<boolean> {
    const result = await limitsModel().deleteOne({
      principalType: principal.principalType,
      principalId: principal.principalId,
    });
    return result.deletedCount > 0;
  }

  /** Cascade for a deleted user, group or role: drops its model grants and usage limits. */
  async function deletePrincipalGovernance(
    principalType: AccessPrincipalType,
    principalId: string,
  ): Promise<void> {
    await Promise.all([
      removePrincipalFromModelGrants({ principalType, principalId }),
      deleteUsageLimits({ principalType, principalId }),
    ]);
  }

  return {
    listModelPolicies,
    findModelPolicyById,
    createModelPolicy,
    updateModelPolicy,
    deleteModelPolicy,
    setPrincipalModelGrants,
    removePrincipalFromModelGrants,
    listUsageLimits,
    findUsageLimitsForPrincipals,
    setUsageLimits,
    deleteUsageLimits,
    deletePrincipalGovernance,
  };
}

/** Whether a policy targets every model of its endpoint. */
export function isEndpointWidePolicy(policy: Pick<ModelPolicyRecord, 'model'>): boolean {
  return policy.model === ANY_MODEL;
}

export type GovernanceMethods = ReturnType<typeof createGovernanceMethods>;
