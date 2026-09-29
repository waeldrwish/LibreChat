import { Schema } from 'mongoose';
import {
  MODEL_GRANT_EFFECTS,
  MODEL_POLICY_ACCESS,
  MODEL_GRANT_PRINCIPALS,
} from 'librechat-data-provider';
import type { IModelPolicy } from '~/types';

const grantSchema = new Schema(
  {
    principalType: { type: String, enum: [...MODEL_GRANT_PRINCIPALS], required: true },
    principalId: { type: String, required: true, maxlength: 256 },
    effect: { type: String, enum: [...MODEL_GRANT_EFFECTS], required: true, default: 'allow' },
  },
  { _id: false },
);

/**
 * Administrator policy for one model (or, with `model: '*'`, every model) of an
 * endpoint: whether it is enabled, who may use it and how it is presented.
 */
const modelPolicySchema: Schema<IModelPolicy> = new Schema<IModelPolicy>(
  {
    endpoint: { type: String, required: true, trim: true, maxlength: 256 },
    model: { type: String, required: true, trim: true, maxlength: 256 },
    label: { type: String, trim: true, maxlength: 256 },
    description: { type: String, maxlength: 2000 },
    enabled: { type: Boolean, default: true },
    access: { type: String, enum: [...MODEL_POLICY_ACCESS], default: 'inherit' },
    maxOutputTokens: { type: Number, min: 1 },
    grants: { type: [grantSchema], default: [] },
    createdBy: { type: String },
    updatedBy: { type: String },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

modelPolicySchema.index({ endpoint: 1, model: 1, tenantId: 1 }, { unique: true });
modelPolicySchema.index({ 'grants.principalType': 1, 'grants.principalId': 1, tenantId: 1 });

export default modelPolicySchema;
