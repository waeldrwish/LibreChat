import type { TModelGrant, TModelsConfig } from 'librechat-data-provider';
import type { ModelPolicyRecord } from '@librechat/data-schemas';
import type { PrincipalSet } from './principals';
import {
  capOutputTokens,
  decideModelAccess,
  filterModelsConfig,
  indexModelPolicies,
  isAgentModelDelegated,
} from './models';

let seq = 0;
function policy(
  endpoint: string,
  model: string,
  overrides: Partial<ModelPolicyRecord> = {},
): ModelPolicyRecord {
  seq += 1;
  return {
    _id: `policy-${seq}`,
    endpoint,
    model,
    enabled: true,
    access: 'inherit',
    grants: [],
    ...overrides,
  };
}

const grant = (
  principalType: TModelGrant['principalType'],
  principalId: string,
  effect: TModelGrant['effect'] = 'allow',
): TModelGrant => ({ principalType, principalId, effect });

const engineer: PrincipalSet = { userId: 'u-eng', role: 'USER', groupIds: ['g-eng'] };
const accountant: PrincipalSet = { userId: 'u-acc', role: 'USER', groupIds: ['g-acc'] };

describe('decideModelAccess', () => {
  it('falls back to the default policy when no policy exists', () => {
    const index = indexModelPolicies([]);
    expect(decideModelAccess(index, engineer, 'openAI', 'gpt-4o', 'allow')).toEqual({
      allowed: true,
      source: 'default',
    });
    expect(decideModelAccess(index, engineer, 'openAI', 'gpt-4o', 'deny')).toEqual({
      allowed: false,
      source: 'default',
    });
  });

  it('denies everyone when the model or its endpoint is disabled', () => {
    const disabledModel = indexModelPolicies([
      policy('openAI', 'gpt-4o', { enabled: false, grants: [grant('user', 'u-eng')] }),
    ]);
    expect(decideModelAccess(disabledModel, engineer, 'openAI', 'gpt-4o', 'allow').allowed).toBe(
      false,
    );

    const disabledEndpoint = indexModelPolicies([policy('openAI', '*', { enabled: false })]);
    expect(
      decideModelAccess(disabledEndpoint, engineer, 'openAI', 'gpt-4o-mini', 'allow').allowed,
    ).toBe(false);
  });

  it('restricts a model to its granted group and inherits the rest to the default', () => {
    const index = indexModelPolicies([
      policy('anthropic', 'claude-opus', {
        access: 'restricted',
        grants: [grant('group', 'g-eng')],
      }),
    ]);
    expect(decideModelAccess(index, engineer, 'anthropic', 'claude-opus', 'allow')).toEqual({
      allowed: true,
      source: 'group',
    });
    expect(decideModelAccess(index, accountant, 'anthropic', 'claude-opus', 'allow')).toEqual({
      allowed: false,
      source: 'policy',
    });
    expect(decideModelAccess(index, accountant, 'anthropic', 'claude-haiku', 'allow').allowed).toBe(
      true,
    );
  });

  it('lets a user-level grant override a group-level deny, and a group deny beat a role allow', () => {
    const index = indexModelPolicies([
      policy('openAI', 'gpt-4o', {
        grants: [grant('group', 'g-eng', 'deny'), grant('role', 'USER', 'allow')],
      }),
    ]);
    expect(decideModelAccess(index, engineer, 'openAI', 'gpt-4o', 'deny')).toEqual({
      allowed: false,
      source: 'group',
    });
    expect(decideModelAccess(index, accountant, 'openAI', 'gpt-4o', 'deny')).toEqual({
      allowed: true,
      source: 'role',
    });

    const withUserAllow = indexModelPolicies([
      policy('openAI', 'gpt-4o', {
        grants: [grant('group', 'g-eng', 'deny'), grant('user', 'u-eng', 'allow')],
      }),
    ]);
    expect(decideModelAccess(withUserAllow, engineer, 'openAI', 'gpt-4o', 'deny')).toEqual({
      allowed: true,
      source: 'user',
    });
  });

  it('makes an explicit deny win over an allow at the same level', () => {
    const multiGroup: PrincipalSet = { userId: 'u-x', role: 'USER', groupIds: ['g-a', 'g-b'] };
    const index = indexModelPolicies([
      policy('openAI', 'gpt-4o', {
        grants: [grant('group', 'g-a', 'allow'), grant('group', 'g-b', 'deny')],
      }),
    ]);
    expect(decideModelAccess(index, multiGroup, 'openAI', 'gpt-4o', 'allow').allowed).toBe(false);
  });

  it('applies endpoint-wide grants to every model, below model-specific grants of the same level', () => {
    const index = indexModelPolicies([
      policy('google', '*', { access: 'restricted', grants: [grant('group', 'g-eng')] }),
      policy('google', 'gemini-pro', { grants: [grant('group', 'g-eng', 'deny')] }),
    ]);
    expect(decideModelAccess(index, engineer, 'google', 'gemini-flash', 'allow').allowed).toBe(
      true,
    );
    expect(decideModelAccess(index, accountant, 'google', 'gemini-flash', 'allow').allowed).toBe(
      false,
    );
    expect(decideModelAccess(index, engineer, 'google', 'gemini-pro', 'allow').allowed).toBe(false);
  });

  it('keeps an inherit policy (created for a single grant) from opening a restricted endpoint', () => {
    const index = indexModelPolicies([
      policy('google', '*', { access: 'restricted' }),
      policy('google', 'gemini-pro', { access: 'inherit', grants: [grant('user', 'u-acc')] }),
    ]);
    expect(decideModelAccess(index, accountant, 'google', 'gemini-pro', 'allow').allowed).toBe(
      true,
    );
    expect(decideModelAccess(index, engineer, 'google', 'gemini-pro', 'allow').allowed).toBe(false);
  });
});

describe('filterModelsConfig and agent delegation', () => {
  const catalog: TModelsConfig = {
    openAI: ['gpt-4o', 'gpt-4o-mini'],
    anthropic: ['claude-opus'],
  };

  it('removes the models the user may not use and never serializes the access context', () => {
    const index = indexModelPolicies([
      policy('anthropic', 'claude-opus', {
        access: 'restricted',
        grants: [grant('agent', 'agent_hr')],
      }),
    ]);
    const filtered = filterModelsConfig(
      catalog,
      index,
      (endpoint, model) => decideModelAccess(index, accountant, endpoint, model, 'allow').allowed,
    );
    expect(filtered).toEqual({ openAI: ['gpt-4o', 'gpt-4o-mini'], anthropic: [] });
    expect(JSON.parse(JSON.stringify(filtered))).toEqual(filtered);

    expect(
      isAgentModelDelegated(
        filtered,
        { id: 'agent_hr', provider: 'anthropic', model: 'claude-opus' },
        'anthropic',
      ),
    ).toBe(true);
    expect(
      isAgentModelDelegated(
        filtered,
        { id: 'agent_other', provider: 'anthropic', model: 'claude-opus' },
        'anthropic',
      ),
    ).toBe(false);
  });

  it('does not delegate a model the provider no longer serves or an ephemeral agent', () => {
    const index = indexModelPolicies([
      policy('anthropic', 'claude-legacy', { grants: [grant('agent', 'agent_hr')] }),
    ]);
    const filtered = filterModelsConfig(catalog, index, () => false);
    expect(
      isAgentModelDelegated(
        filtered,
        { id: 'agent_hr', provider: 'anthropic', model: 'claude-legacy' },
        'anthropic',
      ),
    ).toBe(false);
    expect(
      isAgentModelDelegated(
        filtered,
        { id: 'ephemeral', provider: 'anthropic', model: 'claude-opus' },
        'anthropic',
      ),
    ).toBe(false);
  });
});

describe('capOutputTokens', () => {
  it('lowers a requested value above the cap and keeps a lower one', () => {
    const high: Record<string, unknown> = { max_tokens: 8000 };
    capOutputTokens(high, 1000, 'openAI');
    expect(high.max_tokens).toBe(1000);

    const low: Record<string, unknown> = { maxOutputTokens: 500 };
    capOutputTokens(low, 1000, 'anthropic');
    expect(low.maxOutputTokens).toBe(500);
  });

  it("sets the provider's parameter when none was requested", () => {
    const anthropic: Record<string, unknown> = {};
    capOutputTokens(anthropic, 2048, 'anthropic');
    expect(anthropic).toEqual({ maxOutputTokens: 2048 });

    const custom: Record<string, unknown> = {};
    capOutputTokens(custom, 2048, 'OpenRouter');
    expect(custom).toEqual({ max_tokens: 2048 });
  });
});
