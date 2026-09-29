import { Model } from 'mongoose';
import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import modelPolicySchema from '~/schema/modelPolicy';
import usageLimitSchema from '~/schema/usageLimit';

export function createModelPolicyModel(mongoose: typeof import('mongoose')): Model<t.IModelPolicy> {
  applyTenantIsolation(modelPolicySchema);
  return (
    mongoose.models.ModelPolicy || mongoose.model<t.IModelPolicy>('ModelPolicy', modelPolicySchema)
  );
}

export function createUsageLimitModel(mongoose: typeof import('mongoose')): Model<t.IUsageLimit> {
  applyTenantIsolation(usageLimitSchema);
  return (
    mongoose.models.UsageLimit || mongoose.model<t.IUsageLimit>('UsageLimit', usageLimitSchema)
  );
}
