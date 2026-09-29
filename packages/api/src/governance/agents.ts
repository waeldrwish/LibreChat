import { logger } from '@librechat/data-schemas';
import { ErrorTypes, isAgentsEndpoint, isEphemeralAgentId } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';

export type AgentDisabledError = { type: ErrorTypes.AGENT_DISABLED; info: string };

export interface DisabledAgentGuardDeps {
  isAgentDisabled: (agentId: string) => Promise<boolean>;
  /** Writes the refusal in the route's transport (SSE for chat, JSON for the API). */
  deny: (req: Request, res: Response, error: AgentDisabledError) => Promise<unknown> | unknown;
  /** Agents the request would run; defaults to the chat body's primary and added agent. */
  resolveAgentIds?: (req: Request) => string[];
}

type ChatBody = {
  endpoint?: string;
  agent_id?: unknown;
  addedConvo?: { agent_id?: unknown } | null;
};

/** Persisted agents a chat request would run: the primary agent and a parallel one. */
function requestedAgentIds(body: ChatBody | undefined): string[] {
  const ids: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0 && !isEphemeralAgentId(value)) {
      ids.push(value);
    }
  };
  if (body && isAgentsEndpoint(body.endpoint)) {
    add(body.agent_id);
  }
  add(body?.addedConvo?.agent_id);
  return ids;
}

/** Refuses a chat turn that would run an agent an administrator disabled. */
export function createDisabledAgentGuard(
  deps: DisabledAgentGuardDeps,
): (req: Request, res: Response, next: NextFunction) => Promise<unknown> {
  return async function disabledAgentGuard(req: Request, res: Response, next: NextFunction) {
    const agentIds = deps.resolveAgentIds
      ? deps.resolveAgentIds(req).filter((id) => id.length > 0 && !isEphemeralAgentId(id))
      : requestedAgentIds(req.body as ChatBody | undefined);
    if (agentIds.length === 0) {
      return next();
    }
    try {
      const disabled = await Promise.all(agentIds.map((agentId) => deps.isAgentDisabled(agentId)));
      const index = disabled.findIndex(Boolean);
      if (index === -1) {
        return next();
      }
      return deps.deny(req, res, { type: ErrorTypes.AGENT_DISABLED, info: agentIds[index] });
    } catch (error) {
      logger.error('[disabledAgentGuard] Failed to check agent status', error);
      return next(error);
    }
  };
}
