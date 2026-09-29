import { useState } from 'react';
import { ANY_MODEL } from 'librechat-data-provider';
import {
  Input,
  Label,
  Button,
  Switch,
  Spinner,
  Dropdown,
  OGDialog,
  Textarea,
  MultiSelect,
  OGDialogTemplate,
} from '@librechat/client';
import type {
  TModelGrant,
  TModelPolicy,
  ModelGrantEffect,
  ModelPolicyAccess,
  TModelPolicyUpdate,
} from 'librechat-data-provider';
import type { PickedUser } from '../common/controls';
import {
  useAdminRolesQuery,
  useAdminAgentsQuery,
  useAdminGroupsQuery,
  useAdminUsersByIdQueries,
  useCreateAdminModelPolicyMutation,
  useDeleteAdminModelPolicyMutation,
  useUpdateAdminModelPolicyMutation,
} from '~/data-provider';
import { Field, UserPicker } from '../common/controls';
import { useAdminNotify } from '../common/ui';
import { Cap, useAdmin } from '../context';
import { useLocalize } from '~/hooks';

export type PolicyTarget = { endpoint: string; model: string; policy?: TModelPolicy };

type Audience = { users: PickedUser[]; groupIds: string[]; roles: string[] };
type Option = { value: string; label: string };

function splitGrants(grants: TModelGrant[], effect: ModelGrantEffect) {
  const matching = grants.filter((grant) => grant.effect === effect);
  const ids = (type: TModelGrant['principalType']) =>
    matching.filter((grant) => grant.principalType === type).map((grant) => grant.principalId);
  return {
    userIds: ids('user'),
    groupIds: ids('group'),
    roles: ids('role'),
    agentIds: ids('agent'),
  };
}

function toGrants(audience: Audience, effect: ModelGrantEffect): TModelGrant[] {
  return [
    ...audience.users.map((user) => ({
      principalType: 'user' as const,
      principalId: user.id,
      effect,
    })),
    ...audience.groupIds.map((id) => ({
      principalType: 'group' as const,
      principalId: id,
      effect,
    })),
    ...audience.roles.map((id) => ({ principalType: 'role' as const, principalId: id, effect })),
  ];
}

function AudienceFields({
  title,
  audience,
  onChange,
  groupItems,
  roleItems,
}: {
  title: string;
  audience: Audience;
  onChange: (audience: Audience) => void;
  groupItems: Option[];
  roleItems: Option[];
}) {
  const localize = useLocalize();
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border-light p-3">
      <legend className="px-1 text-sm font-medium text-text-primary">{title}</legend>
      <UserPicker
        label={localize('com_admin_policy_users')}
        selected={audience.users}
        onChange={(users) => onChange({ ...audience, users })}
      />
      {groupItems.length > 0 && (
        <MultiSelect
          items={groupItems}
          label={localize('com_admin_policy_groups')}
          labelClassName="sr-only"
          placeholder={localize('com_admin_policy_groups')}
          selectedValues={audience.groupIds}
          setSelectedValues={(groupIds) => onChange({ ...audience, groupIds })}
        />
      )}
      {roleItems.length > 0 && (
        <MultiSelect
          items={roleItems}
          label={localize('com_admin_policy_roles')}
          labelClassName="sr-only"
          placeholder={localize('com_admin_policy_roles')}
          selectedValues={audience.roles}
          setSelectedValues={(roles) => onChange({ ...audience, roles })}
        />
      )}
    </fieldset>
  );
}

function PolicyForm({
  target,
  initialUsers,
  onClose,
}: {
  target: PolicyTarget;
  initialUsers: Map<string, PickedUser>;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const { can } = useAdmin();
  const policy = target.policy;
  const groups = useAdminGroupsQuery({ limit: 200 }, can(Cap.READ_GROUPS));
  const roles = useAdminRolesQuery(can(Cap.READ_ROLES));
  const agents = useAdminAgentsQuery({ limit: 200 }, can(Cap.READ_AGENTS));
  const create = useCreateAdminModelPolicyMutation();
  const update = useUpdateAdminModelPolicyMutation();
  const remove = useDeleteAdminModelPolicyMutation();

  const [initial] = useState(() => {
    const allowSplit = splitGrants(policy?.grants ?? [], 'allow');
    const denySplit = splitGrants(policy?.grants ?? [], 'deny');
    const resolve = (ids: string[]) =>
      ids.map((id) => initialUsers.get(id) ?? { id, name: id, email: '' });
    return {
      allow: {
        users: resolve(allowSplit.userIds),
        groupIds: allowSplit.groupIds,
        roles: allowSplit.roles,
      },
      deny: {
        users: resolve(denySplit.userIds),
        groupIds: denySplit.groupIds,
        roles: denySplit.roles,
      },
      agentIds: allowSplit.agentIds,
    };
  });
  const [label, setLabel] = useState(policy?.label ?? '');
  const [description, setDescription] = useState(policy?.description ?? '');
  const [enabled, setEnabled] = useState(policy?.enabled ?? true);
  const [access, setAccess] = useState<ModelPolicyAccess>(policy?.access ?? 'inherit');
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    policy?.maxOutputTokens ? String(policy.maxOutputTokens) : '',
  );
  const [allow, setAllow] = useState<Audience>(initial.allow);
  const [deny, setDeny] = useState<Audience>(initial.deny);
  const [agentIds, setAgentIds] = useState<string[]>(initial.agentIds);

  const groupItems = (groups.data?.groups ?? []).map((group) => ({
    value: group._id,
    label: group.name,
  }));
  const roleItems = (roles.data?.roles ?? []).map((role) => ({
    value: role.name,
    label: role.name,
  }));
  const agentItems = (agents.data?.agents ?? []).map((agent) => ({
    value: agent.id,
    label: agent.name,
  }));
  const isSaving = create.isLoading || update.isLoading;
  const tokens = maxOutputTokens.trim() === '' ? null : Number(maxOutputTokens);
  const tokensInvalid = tokens != null && (!Number.isInteger(tokens) || tokens <= 0);
  const isEndpointWide = target.model === ANY_MODEL;

  const save = () => {
    if (tokensInvalid) {
      return;
    }
    const grants: TModelGrant[] = [
      ...toGrants(allow, 'allow'),
      ...toGrants(deny, 'deny'),
      ...agentIds.map((id) => ({
        principalType: 'agent' as const,
        principalId: id,
        effect: 'allow' as const,
      })),
    ];
    const changes: TModelPolicyUpdate = {
      label: label.trim() || undefined,
      description: description.trim() || undefined,
      enabled,
      access,
      maxOutputTokens: tokens,
      grants,
    };
    const handlers = {
      onSuccess: () => {
        notify.success(localize('com_admin_saved'));
        onClose();
      },
      onError: notify.error,
    };
    if (policy) {
      update.mutate({ id: policy.id, body: changes }, handlers);
      return;
    }
    create.mutate(
      {
        endpoint: target.endpoint,
        model: target.model,
        label: changes.label,
        description: changes.description,
        enabled,
        access,
        grants,
        maxOutputTokens: tokens ?? undefined,
      },
      handlers,
    );
  };

  return (
    <OGDialogTemplate
      title={
        isEndpointWide
          ? localize('com_admin_policy_title_endpoint', { 0: target.endpoint })
          : localize('com_admin_policy_title', { 0: target.model })
      }
      className="max-w-2xl"
      mainClassName="max-h-[70vh] overflow-y-auto"
      main={
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="policy-enabled">{localize('com_admin_policy_enabled')}</Label>
            <Switch
              id="policy-enabled"
              aria-label={localize('com_admin_policy_enabled')}
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
          {!isEndpointWide && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={localize('com_admin_policy_label')}>
                  {(id) => (
                    <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} />
                  )}
                </Field>
                <Field
                  label={localize('com_admin_policy_max_tokens')}
                  hint={localize('com_admin_policy_max_tokens_hint')}
                >
                  {(id, describedBy) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      dir="ltr"
                      aria-describedby={describedBy}
                      aria-invalid={tokensInvalid}
                      value={maxOutputTokens}
                      onChange={(e) => setMaxOutputTokens(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label={localize('com_admin_field_description')}>
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>{localize('com_admin_policy_access')}</Label>
            <Dropdown
              variant="field"
              ariaLabel={localize('com_admin_policy_access')}
              value={access}
              onChange={(value) => setAccess(value as ModelPolicyAccess)}
              options={[
                { value: 'inherit', label: localize('com_admin_policy_access_inherit') },
                { value: 'all', label: localize('com_admin_policy_access_all') },
                { value: 'restricted', label: localize('com_admin_policy_access_restricted') },
              ]}
            />
            <p className="text-xs text-text-secondary">{localize('com_admin_policy_precedence')}</p>
          </div>
          <AudienceFields
            title={localize('com_admin_policy_allowed_for')}
            audience={allow}
            onChange={setAllow}
            groupItems={groupItems}
            roleItems={roleItems}
          />
          <AudienceFields
            title={localize('com_admin_policy_denied_for')}
            audience={deny}
            onChange={setDeny}
            groupItems={groupItems}
            roleItems={roleItems}
          />
          {agentItems.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>{localize('com_admin_policy_agents')}</Label>
              <MultiSelect
                items={agentItems}
                label={localize('com_admin_policy_agents')}
                labelClassName="sr-only"
                placeholder={localize('com_admin_policy_agents_placeholder')}
                selectedValues={agentIds}
                setSelectedValues={setAgentIds}
              />
              <p className="text-xs text-text-secondary">
                {localize('com_admin_policy_agents_hint')}
              </p>
            </div>
          )}
          {tokensInvalid && (
            <p role="alert" className="text-sm text-text-destructive">
              {localize('com_admin_policy_max_tokens_invalid')}
            </p>
          )}
        </div>
      }
      leftButtons={
        policy ? (
          <Button
            variant="outline"
            disabled={remove.isLoading}
            onClick={() =>
              remove.mutate(policy.id, {
                onSuccess: () => {
                  notify.success(localize('com_admin_policy_reset_done'));
                  onClose();
                },
                onError: notify.error,
              })
            }
          >
            {localize('com_admin_policy_reset')}
          </Button>
        ) : undefined
      }
      selection={
        <Button onClick={save} disabled={isSaving || tokensInvalid}>
          {isSaving ? <Spinner className="size-4" /> : localize('com_admin_save')}
        </Button>
      }
    />
  );
}

/**
 * Edits the policy of one model (or of every model of a provider when `model` is `*`):
 * availability, who may use it, which agents may run it, and an output-token cap.
 */
export default function PolicyDialog({
  target,
  onClose,
}: {
  target: PolicyTarget | null;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const userIds = (target?.policy?.grants ?? [])
    .filter((grant) => grant.principalType === 'user')
    .map((grant) => grant.principalId);
  const userQueries = useAdminUsersByIdQueries(userIds);
  const ready = userQueries.every((query) => !query.isLoading);
  const users = new Map<string, PickedUser>(
    userQueries
      .map((query) => query.data?.user)
      .filter((user): user is NonNullable<typeof user> => user != null)
      .map((user) => [user.id, { id: user.id, name: user.name, email: user.email }]),
  );

  return (
    <OGDialog open={target != null} onOpenChange={(next) => !next && onClose()}>
      {target != null &&
        (ready ? (
          <PolicyForm
            key={`${target.endpoint}|${target.model}|${target.policy?.updatedAt ?? ''}`}
            target={target}
            initialUsers={users}
            onClose={onClose}
          />
        ) : (
          <OGDialogTemplate
            title={localize('com_admin_loading')}
            main={<Spinner className="size-6 text-text-secondary" />}
          />
        ))}
    </OGDialog>
  );
}
