import { LayoutGrid } from 'lucide-react';
import { CHAT_SECTIONS } from 'librechat-data-provider';
import {
  Table,
  Switch,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from '@librechat/client';
import type { ChatSectionKey, TAdminSections } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminSectionsQuery, useUpdateAdminSectionMutation } from '~/data-provider';
import { Empty, Panel, PageHeader, QueryState, useAdminNotify } from '../common/ui';
import { useLocalize } from '~/hooks';

const SECTION_LABELS: Record<ChatSectionKey, TranslationKeys> = {
  modelSelect: 'com_admin_section_model_select',
  parameters: 'com_admin_section_parameters',
  presets: 'com_admin_section_presets',
  agents: 'com_admin_section_agents',
  agentBuilder: 'com_admin_section_agent_builder',
  agentSharing: 'com_admin_section_agent_sharing',
  marketplace: 'com_admin_section_marketplace',
  prompts: 'com_admin_section_prompts',
  skills: 'com_admin_section_skills',
  bookmarks: 'com_admin_section_bookmarks',
  memories: 'com_admin_section_memories',
  multiConvo: 'com_admin_section_multi_convo',
  temporaryChat: 'com_admin_section_temporary_chat',
  webSearch: 'com_admin_section_web_search',
  runCode: 'com_admin_section_run_code',
  fileSearch: 'com_admin_section_file_search',
  fileCitations: 'com_admin_section_file_citations',
  mcpServers: 'com_admin_section_mcp_servers',
  sharedLinks: 'com_admin_section_shared_links',
  schedules: 'com_admin_section_schedules',
  contextUsage: 'com_admin_section_context_usage',
  feedback: 'com_admin_section_feedback',
};

function SectionsTable({ data }: { data: TAdminSections }) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const update = useUpdateAdminSectionMutation();
  const globallyOff = new Set(data.globallyOff);

  const toggle = (role: string, section: ChatSectionKey, visible: boolean) =>
    update.mutate(
      { role, update: { section, visible } },
      {
        onSuccess: () =>
          notify.success(
            localize(visible ? 'com_admin_section_shown' : 'com_admin_section_hidden', {
              0: localize(SECTION_LABELS[section]),
              1: role,
            }),
          ),
        onError: notify.error,
      },
    );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{localize('com_admin_section')}</TableHead>
            {data.roles.map((role) => (
              <TableHead key={role.name} className="text-center">
                <span dir="ltr">{role.name}</span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {CHAT_SECTIONS.map(({ key }) => {
            const label = localize(SECTION_LABELS[key]);
            const off = globallyOff.has(key);
            return (
              <TableRow key={key}>
                <TableCell>
                  <span className="block font-medium text-text-primary">{label}</span>
                  {off && (
                    <span className="text-xs text-text-secondary">
                      {localize('com_admin_section_globally_off')}
                    </span>
                  )}
                </TableCell>
                {data.roles.map((role) => (
                  <TableCell key={role.name} className="text-center">
                    <Switch
                      aria-label={localize('com_admin_section_toggle', { 0: label, 1: role.name })}
                      checked={role.visible[key] === true}
                      disabled={!data.canManage || update.isLoading}
                      onCheckedChange={(visible) => toggle(role.name, key, visible)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function SectionsPage() {
  const localize = useLocalize();
  const sections = useAdminSectionsQuery();
  return (
    <>
      <PageHeader
        title={localize('com_admin_nav_sections')}
        description={localize('com_admin_sections_description')}
      />
      <Panel>
        <QueryState
          query={sections}
          isEmpty={(data) => data.roles.length === 0}
          empty={<Empty icon={LayoutGrid} title={localize('com_admin_roles_empty')} />}
        >
          {(data) => <SectionsTable data={data} />}
        </QueryState>
        <p className="mt-3 text-xs text-text-secondary">{localize('com_admin_sections_hint')}</p>
      </Panel>
    </>
  );
}
