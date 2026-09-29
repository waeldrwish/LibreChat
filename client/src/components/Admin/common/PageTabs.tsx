import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@librechat/client';
import type { ReactNode } from 'react';
import { useAdmin } from '../context';

export type PageTab = { value: string; label: string; content: ReactNode };

/** Page-level tabs kept in `?tab=`, so a link (or a redirect after create) can open one. */
export default function PageTabs({ tabs, label }: { tabs: PageTab[]; label: string }) {
  const { dir } = useAdmin();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const active = tabs.some((tab) => tab.value === requested) ? requested! : tabs[0]?.value;

  return (
    <Tabs
      dir={dir}
      value={active}
      onValueChange={(value) =>
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set('tab', value);
            return next;
          },
          { replace: true },
        )
      }
    >
      <TabsList
        aria-label={label}
        className="mb-4 flex w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border-light bg-transparent"
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="rounded-none border-b-2 border-transparent px-3 py-2 text-sm text-text-secondary data-[state=active]:border-text-primary data-[state=active]:text-text-primary"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
