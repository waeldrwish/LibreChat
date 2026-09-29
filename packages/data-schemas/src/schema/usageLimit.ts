import { Schema } from 'mongoose';
import { ACCESS_PRINCIPAL_TYPES, UNLIMITED_USAGE } from 'librechat-data-provider';
import type { IUsageLimit } from '~/types';

const limitValue = { type: Number, min: UNLIMITED_USAGE };

/**
 * Usage limits assigned to one user, group or role. Unset metrics inherit from
 * the next level (user → group → role → `governance.limits.defaults`).
 */
const usageLimitSchema: Schema<IUsageLimit> = new Schema<IUsageLimit>(
  {
    principalType: { type: String, enum: [...ACCESS_PRINCIPAL_TYPES], required: true },
    principalId: { type: String, required: true, maxlength: 256 },
    limits: {
      type: new Schema(
        {
          tokensPerDay: limitValue,
          tokensPerMonth: limitValue,
          messagesPerDay: limitValue,
          messagesPerMonth: limitValue,
        },
        { _id: false },
      ),
      default: {},
    },
    updatedBy: { type: String },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

usageLimitSchema.index({ principalType: 1, principalId: 1, tenantId: 1 }, { unique: true });

export default usageLimitSchema;
