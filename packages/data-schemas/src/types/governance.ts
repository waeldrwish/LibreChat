import type {
  TModelGrant,
  TUsageLimits,
  ModelPolicyAccess,
  AccessPrincipalType,
} from 'librechat-data-provider';
import type { Document, Types } from 'mongoose';

export type ModelPolicy = {
  endpoint: string;
  /** A model id, or `*` for every model of `endpoint`. */
  model: string;
  label?: string;
  description?: string;
  enabled: boolean;
  access: ModelPolicyAccess;
  maxOutputTokens?: number;
  grants: TModelGrant[];
  createdBy?: string;
  updatedBy?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

/** `model` is a policy field, so the Document's `model()` accessor is omitted (as on `IAgent`). */
export type IModelPolicy = ModelPolicy &
  Omit<Document, 'model'> & {
    _id: Types.ObjectId;
  };

/** Plain policy record as returned by the governance methods. */
export type ModelPolicyRecord = ModelPolicy & { _id: string };

export type ModelPolicyWrite = Omit<ModelPolicy, 'tenantId' | 'createdAt' | 'updatedAt'>;

export type UsageLimit = {
  principalType: AccessPrincipalType;
  principalId: string;
  limits: TUsageLimits;
  updatedBy?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type IUsageLimit = UsageLimit &
  Document & {
    _id: Types.ObjectId;
  };

export type UsageLimitRecord = Omit<UsageLimit, 'tenantId'>;

export type UsagePrincipalRef = {
  principalType: AccessPrincipalType;
  principalId: string;
};
