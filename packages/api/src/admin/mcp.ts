import { logger } from '@librechat/data-schemas';
import type {
  TAdminMCPServer,
  TConfiguredMCPServer,
  TAdminMCPServersPage,
} from 'librechat-data-provider';
import type { AppConfig, DirectoryMethods, AdminMCPServerRecord } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminHandler } from './trail';
import { parsePagination } from './pagination';

export interface AdminMCPDeps {
  listAdminMCPServers: DirectoryMethods['listAdminMCPServers'];
  summarizeMCPServerSharing: DirectoryMethods['summarizeMCPServerSharing'];
  /** The YAML-derived config only. */
  getYamlConfig: () => Promise<AppConfig>;
}

type ServerOptions = { title?: string; description?: string; type?: string; url?: string };

function toAdminMCPServer(
  record: AdminMCPServerRecord,
  sharing?: { sharedWith: number; isPublic: boolean },
): TAdminMCPServer {
  return {
    dbId: record._id,
    serverName: record.serverName,
    title: record.title,
    description: record.description,
    transport: record.transport,
    url: record.url,
    authorId: record.author,
    authorName: record.authorName,
    sharedWith: sharing?.sharedWith ?? 0,
    isPublic: sharing?.isPublic ?? false,
    updatedAt: record.updatedAt?.toISOString(),
  };
}

/** YAML servers carry no secrets worth showing; only what identifies them is listed. */
function toConfiguredServers(mcpConfig: AppConfig['mcpConfig']): TConfiguredMCPServer[] {
  return Object.entries(mcpConfig ?? {}).map(([serverName, raw]) => {
    const options = (raw ?? {}) as ServerOptions;
    return {
      serverName,
      title: options.title,
      description: options.description,
      transport: options.type ?? (options.url ? undefined : 'stdio'),
      url: options.url,
    };
  });
}

/**
 * The MCP server inventory: every server stored in the database, whoever created
 * it, next to those `librechat.yaml` defines. Creating, editing and sharing go
 * through the existing MCP server API, which applies its own authorization.
 */
export function createAdminMCPHandlers(deps: AdminMCPDeps): Record<'list', AdminHandler> {
  async function list(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { limit, offset } = parsePagination(req.query as { limit?: string; offset?: string });
      const search = (req.query as { search?: unknown }).search;
      const [{ servers, total }, yamlConfig] = await Promise.all([
        deps.listAdminMCPServers({
          search: typeof search === 'string' ? search : undefined,
          limit,
          offset,
        }),
        deps.getYamlConfig(),
      ]);
      const sharing = await deps.summarizeMCPServerSharing(servers.map((server) => server._id));
      const body: TAdminMCPServersPage = {
        servers: servers.map((server) => toAdminMCPServer(server, sharing.get(server._id))),
        total,
        limit,
        offset,
        configured: toConfiguredServers(yamlConfig?.mcpConfig),
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminMCP] list error:', error);
      return res.status(500).json({ error: 'Failed to list MCP servers' });
    }
  }

  return { list };
}
