import { logger } from '@librechat/data-schemas';
import { ViolationTypes } from 'librechat-data-provider';
import type { TUsageLimitError } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '@librechat/data-schemas';
import type { GovernanceService, GovernanceUser } from './service';
import type { LimitExceeded } from './limits';
import { TtlCache } from './cache';

type GuardRequest = Request & { user?: GovernanceUser & { name?: string; email?: string } };

export interface UsageLimitGuardDeps {
  governance: GovernanceService;
  /** Resolves the request's app config when middleware has not attached `req.config`. */
  getAppConfig?: (req: GuardRequest) => Promise<AppConfig | undefined>;
  /** Writes the refusal in the transport the route speaks (SSE for chat, JSON for the API). */
  deny: (req: GuardRequest, res: Response, error: TUsageLimitError) => Promise<unknown> | unknown;
  /** Records the refusal (e.g. an audit entry); called at most once per user, metric and window. */
  onExceeded?: (req: GuardRequest, exceeded: LimitExceeded) => Promise<unknown> | unknown;
  /** Requests the guard lets through untouched (e.g. resuming an already admitted turn). */
  skip?: (req: GuardRequest) => boolean;
}

const REPORT_DEDUPE_MS = 10 * 60 * 1000;

export function toUsageLimitError(exceeded: LimitExceeded): TUsageLimitError {
  return {
    type: ViolationTypes.USAGE_LIMIT,
    metric: exceeded.metric,
    limit: exceeded.limit,
    used: exceeded.used,
    resetAt: exceeded.resetAt.toISOString(),
  };
}

/**
 * Refuses a new turn once the user reached an administrator-assigned usage limit.
 * A failure to evaluate limits is logged and the request proceeds: a transient
 * database error should not take chat down for every user.
 */
export function createUsageLimitGuard(
  deps: UsageLimitGuardDeps,
): (req: GuardRequest, res: Response, next: NextFunction) => Promise<void> {
  const reported = new TtlCache<true>();

  return async function usageLimitGuard(
    req: GuardRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.user || deps.skip?.(req)) {
      next();
      return;
    }
    let exceeded: LimitExceeded | null = null;
    try {
      const appConfig =
        (req as GuardRequest & { config?: AppConfig }).config ?? (await deps.getAppConfig?.(req));
      const check = await deps.governance.checkUsage({ user: req.user, appConfig });
      exceeded = check?.exceeded ?? null;
    } catch (error) {
      logger.error('[usageLimitGuard] Failed to evaluate usage limits; allowing request', error);
      next();
      return;
    }

    if (!exceeded) {
      next();
      return;
    }

    const userId = req.user.id ?? req.user._id?.toString() ?? '';
    const reportKey = `${userId}:${exceeded.metric}:${exceeded.resetAt.getTime()}`;
    if (deps.onExceeded && !reported.get(reportKey)) {
      reported.set(reportKey, true, REPORT_DEDUPE_MS);
      Promise.resolve(deps.onExceeded(req, exceeded)).catch((error) =>
        logger.warn('[usageLimitGuard] Failed to record exceeded limit', error),
      );
    }
    await deps.deny(req, res, toUsageLimitError(exceeded));
  };
}
