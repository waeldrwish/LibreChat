import { logger } from '@librechat/data-schemas';
import type {
  AuditAction,
  AuditOutcome,
  AuditMetadata,
  AuditSeverity,
  AuditTargetInput,
  RecordAuditEntryInput,
  RecordAuditEntryOptions,
} from '@librechat/data-schemas';
import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { buildAuditContext } from './context';

/** An admin route handler. */
export type AdminHandler = (req: ServerRequest, res: Response) => Promise<Response>;

/** The administrator performing a request, as the admin handlers need it. */
export type AdminActor = {
  userId: string;
  name: string;
  role: string;
  tenantId?: string;
  idOnTheSource?: string | null;
};

export function resolveAdminActor(req: ServerRequest): AdminActor | null {
  const user = req.user;
  if (!user) {
    return null;
  }
  const userId = user._id?.toString() ?? user.id;
  if (!userId || !user.role) {
    return null;
  }
  return {
    userId,
    role: user.role,
    name: user.name || user.username || user.email || userId,
    tenantId: user.tenantId,
    idOnTheSource: user.idOnTheSource ?? null,
  };
}

export type RecordAuditEntry = (
  input: RecordAuditEntryInput,
  options?: RecordAuditEntryOptions,
) => Promise<unknown>;

export type AdminAuditEvent = {
  action: AuditAction;
  target: AuditTargetInput;
  metadata?: AuditMetadata;
  outcome?: AuditOutcome;
  severity?: AuditSeverity;
};

export type AdminAuditRecorder = (req: ServerRequest, event: AdminAuditEvent) => Promise<void>;

/**
 * Records an administrative action with the request's actor and forensic
 * context. Fail-open: an audit write failure is logged and never undoes the
 * action that already happened.
 */
export function createAdminAuditRecorder(recordAuditEntry?: RecordAuditEntry): AdminAuditRecorder {
  return async function recordAdminAction(
    req: ServerRequest,
    event: AdminAuditEvent,
  ): Promise<void> {
    if (!recordAuditEntry) {
      return;
    }
    const actor = resolveAdminActor(req);
    try {
      await recordAuditEntry({
        action: event.action,
        outcome: event.outcome ?? 'success',
        ...(event.severity ? { severity: event.severity } : {}),
        actor: actor
          ? { type: 'user', id: actor.userId, name: actor.name }
          : { type: 'system', name: 'system' },
        target: event.target,
        metadata: event.metadata,
        context: buildAuditContext(req),
        tenantId: actor?.tenantId,
      });
    } catch (error) {
      logger.error(`[adminAudit] Failed to record ${event.action}`, error);
    }
  };
}

/**
 * Declares how a route of an existing router is audited. `path` matches the
 * router-relative path; its capture groups become `params`. `response` is the
 * JSON body the handler sent, when it sent one.
 */
export type AuditTrailRule = {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: RegExp;
  describe: (context: {
    req: ServerRequest;
    params: string[];
    response: unknown;
  }) => AdminAuditEvent | null;
};

/**
 * Audits successful (2xx) mutations of routers whose handlers do not record
 * audit entries themselves, so every administrative change lands in the log.
 */
export function createAuditTrail(
  recorder: AdminAuditRecorder,
  rules: AuditTrailRule[],
): (req: ServerRequest, res: Response, next: NextFunction) => void {
  return function auditTrail(req: ServerRequest, res: Response, next: NextFunction) {
    const method = req.method.toUpperCase();
    const path = req.path;
    let params: string[] | null = null;
    const rule = rules.find((candidate) => {
      if (candidate.method !== method) {
        return false;
      }
      const match = candidate.path.exec(path);
      if (!match) {
        return false;
      }
      params = match.slice(1).map((value) => decodeURIComponent(value ?? ''));
      return true;
    });
    if (!rule || !params) {
      return next();
    }

    let response: unknown;
    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      response = body;
      return json(body);
    };

    const matchedParams: string[] = params;
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return;
      }
      let event: AdminAuditEvent | null = null;
      try {
        event = rule.describe({ req, params: matchedParams, response });
      } catch (error) {
        logger.warn('[adminAudit] Failed to describe audited request', error);
      }
      if (event) {
        void recorder(req, event);
      }
    });
    return next();
  };
}
