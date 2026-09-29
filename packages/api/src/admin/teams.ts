import { z } from 'zod';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { DirectoryMethods } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminAuditRecorder, AdminHandler } from './trail';
import type { ServerRequest } from '~/types/http';

const MAX_MANAGERS = 50;

const managersSchema = z
  .array(z.string().refine(isValidObjectIdString, { message: 'Invalid user id' }))
  .max(MAX_MANAGERS);

export interface AdminTeamsDeps {
  setGroupManagers: DirectoryMethods['setGroupManagers'];
  findAdminUserById: DirectoryMethods['findAdminUserById'];
  recordAdminAction: AdminAuditRecorder;
}

/** Assigns the managers who oversee a group's members (the "team" of the manager role). */
export function createAdminTeamHandlers(deps: AdminTeamsDeps): Record<'setManagers', AdminHandler> {
  async function setManagers(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid group id' });
      }
      const parsed = managersSchema.safeParse((req.body as { managerIds?: unknown })?.managerIds);
      if (!parsed.success) {
        return res.status(400).json({ error: 'managerIds must be a list of user ids' });
      }
      const managerIds = [...new Set(parsed.data)];
      const users = await Promise.all(managerIds.map((userId) => deps.findAdminUserById(userId)));
      if (users.some((user) => user == null)) {
        return res.status(400).json({ error: 'User not found' });
      }
      const group = await deps.setGroupManagers(id, managerIds);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }
      await deps.recordAdminAction(req, {
        action: 'group.updated',
        severity: 'warning',
        target: { type: 'group', id, name: group.name },
        metadata: { managers: managerIds.join(',') },
      });
      return res.status(200).json({ group });
    } catch (error) {
      logger.error('[adminTeams] setManagers error:', error);
      return res.status(500).json({ error: 'Failed to update group managers' });
    }
  }

  return { setManagers };
}
