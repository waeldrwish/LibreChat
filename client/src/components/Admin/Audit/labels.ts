import type { AuditAction, AuditCategory, AuditOutcome } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';

type Labels = Readonly<Record<string, TranslationKeys | undefined>>;

/** Entries written before an action was known keep their raw name instead of a missing key. */
export const ACTION_LABELS: Labels = {
  'grant.assigned': 'com_admin_audit_action_grant_assigned',
  'grant.removed': 'com_admin_audit_action_grant_removed',
  'permission.insights_assigned': 'com_admin_audit_action_permission_insights_assigned',
  'permission.insights_removed': 'com_admin_audit_action_permission_insights_removed',
  'permission.access_updated': 'com_admin_audit_action_permission_access_updated',
  'config.updated': 'com_admin_audit_action_config_updated',
  'config.deleted': 'com_admin_audit_action_config_deleted',
  'user.created': 'com_admin_audit_action_user_created',
  'user.updated': 'com_admin_audit_action_user_updated',
  'user.disabled': 'com_admin_audit_action_user_disabled',
  'user.enabled': 'com_admin_audit_action_user_enabled',
  'user.password_reset': 'com_admin_audit_action_user_password_reset',
  'group.created': 'com_admin_audit_action_group_created',
  'group.updated': 'com_admin_audit_action_group_updated',
  'group.deleted': 'com_admin_audit_action_group_deleted',
  'group.member_added': 'com_admin_audit_action_group_member_added',
  'group.member_removed': 'com_admin_audit_action_group_member_removed',
  'role.created': 'com_admin_audit_action_role_created',
  'role.updated': 'com_admin_audit_action_role_updated',
  'role.deleted': 'com_admin_audit_action_role_deleted',
  'role.permissions_updated': 'com_admin_audit_action_role_permissions_updated',
  'role.member_added': 'com_admin_audit_action_role_member_added',
  'role.member_removed': 'com_admin_audit_action_role_member_removed',
  'model.policy_created': 'com_admin_audit_action_model_policy_created',
  'model.policy_updated': 'com_admin_audit_action_model_policy_updated',
  'model.policy_deleted': 'com_admin_audit_action_model_policy_deleted',
  'agent.enabled': 'com_admin_audit_action_agent_enabled',
  'agent.disabled': 'com_admin_audit_action_agent_disabled',
  'agent.access_updated': 'com_admin_audit_action_agent_access_updated',
  'agent.deleted': 'com_admin_audit_action_agent_deleted',
  'usage.limits_updated': 'com_admin_audit_action_usage_limits_updated',
  'usage.limit_exceeded': 'com_admin_audit_action_usage_limit_exceeded',
  'tool.enabled': 'com_admin_audit_action_tool_enabled',
  'tool.disabled': 'com_admin_audit_action_tool_disabled',
  'tool.credentials_updated': 'com_admin_audit_action_tool_credentials_updated',
} satisfies Record<AuditAction, TranslationKeys>;

export const CATEGORY_LABELS: Labels = {
  grant: 'com_admin_audit_category_grant',
  agent_run: 'com_admin_audit_category_agent_run',
  tool_call: 'com_admin_audit_category_tool_call',
  mcp: 'com_admin_audit_category_mcp',
  config: 'com_admin_audit_category_config',
  permission: 'com_admin_audit_category_permission',
  auth: 'com_admin_audit_category_auth',
  approval: 'com_admin_audit_category_approval',
  user: 'com_admin_audit_category_user',
  group: 'com_admin_audit_category_group',
  role: 'com_admin_audit_category_role',
  model: 'com_admin_audit_category_model',
  agent: 'com_admin_audit_category_agent',
  usage: 'com_admin_audit_category_usage',
  tool: 'com_admin_audit_category_tool',
} satisfies Record<AuditCategory, TranslationKeys>;

export const OUTCOME_LABELS: Labels = {
  success: 'com_admin_audit_outcome_success',
  failure: 'com_admin_audit_outcome_failure',
  denied: 'com_admin_audit_outcome_denied',
  pending: 'com_admin_audit_outcome_pending',
} satisfies Record<AuditOutcome, TranslationKeys>;

/** Localizes an audit value through one of the maps above, falling back to the raw value. */
export function useAuditLabel(): (labels: Labels, value: string) => string {
  const localize = useLocalize();
  return (labels, value) => {
    const key = labels[value];
    return key ? localize(key) : value;
  };
}
