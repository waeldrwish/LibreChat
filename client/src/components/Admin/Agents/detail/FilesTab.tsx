import { useRef, useState } from 'react';
import { v4 } from 'uuid';
import { Button, Spinner } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Upload } from 'lucide-react';
import {
  QueryKeys,
  FileSources,
  dataService,
  EToolResources,
  EModelEndpoint,
  DynamicQueryKeys,
} from 'librechat-data-provider';
import type { Agent, TFile } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { Empty, Panel, SectionTitle, useAdminNotify } from '../../common/ui';
import { useAdminFormat } from '../../common/format';
import { useGetAgentFiles } from '~/data-provider';
import { useLocalize } from '~/hooks';

type Resource = EToolResources.file_search | EToolResources.execute_code;

const RESOURCES: Array<{ resource: Resource; title: TranslationKeys; hint: TranslationKeys }> = [
  {
    resource: EToolResources.file_search,
    title: 'com_admin_agent_files_search',
    hint: 'com_admin_agent_files_search_hint',
  },
  {
    resource: EToolResources.execute_code,
    title: 'com_admin_agent_files_code',
    hint: 'com_admin_agent_files_code_hint',
  },
];

function ResourceFiles({
  agent,
  resource,
  title,
  hint,
  files,
}: {
  agent: Agent;
  resource: Resource;
  title: string;
  hint: string;
  files: TFile[];
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const format = useAdminFormat();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(DynamicQueryKeys.agentFiles(agent.id)),
      queryClient.invalidateQueries([QueryKeys.agent, agent.id, 'expanded']),
    ]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) {
      return;
    }
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.append('endpoint', EModelEndpoint.agents);
        form.append('endpointType', '');
        form.append('file', file, encodeURIComponent(file.name));
        form.append('file_id', v4());
        form.append('tool_resource', resource);
        form.append('agent_id', agent.id);
        await dataService.uploadFile(form);
      }
      notify.success(localize('com_admin_agent_files_uploaded'));
    } catch (error) {
      notify.error(error);
    } finally {
      setBusy(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      await refresh();
    }
  };

  const remove = async (file: TFile) => {
    setBusy(true);
    try {
      await dataService.deleteFiles({
        files: [
          {
            file_id: file.file_id,
            filepath: file.filepath,
            embedded: file.embedded ?? false,
            source: file.source ?? FileSources.local,
          },
        ],
        agent_id: agent.id,
        tool_resource: resource,
      });
      notify.success(localize('com_admin_agent_files_removed'));
    } catch (error) {
      notify.error(error);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  return (
    <Panel>
      <SectionTitle
        actions={
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => upload(event.target.files)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? (
                <Spinner className="size-4" />
              ) : (
                <Upload className="size-4" aria-hidden="true" />
              )}
              {localize('com_admin_agent_files_upload')}
            </Button>
          </>
        }
      >
        {title}
      </SectionTitle>
      <p className="mb-3 text-sm text-text-secondary">{hint}</p>
      {files.length === 0 ? (
        <Empty icon={FileText} title={localize('com_admin_agent_files_empty')} />
      ) : (
        <ul className="divide-y divide-border-light">
          {files.map((file) => (
            <li key={file.file_id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm text-text-primary" dir="auto">
                  {file.filename}
                </span>
                <span className="text-xs text-text-secondary">
                  {format.date(file.createdAt as string | undefined)}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={localize('com_admin_agent_files_remove', { 0: file.filename })}
                onClick={() => remove(file)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function FilesTab({ agent }: { agent: Agent }) {
  const localize = useLocalize();
  const files = useGetAgentFiles(agent.id, { refetchOnMount: true });
  const byId = new Map((files.data ?? []).map((file) => [file.file_id, file]));

  return (
    <div className="flex flex-col gap-4">
      {RESOURCES.map(({ resource, title, hint }) => {
        const ids = agent.tool_resources?.[resource]?.file_ids ?? [];
        const attached = ids
          .map((id) => byId.get(id))
          .filter((file): file is TFile => file != null);
        return (
          <ResourceFiles
            key={resource}
            agent={agent}
            resource={resource}
            title={localize(title)}
            hint={localize(hint)}
            files={attached}
          />
        );
      })}
    </div>
  );
}
