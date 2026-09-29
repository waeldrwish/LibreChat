import type { ReactNode } from 'react';
import { cn } from '~/utils';

/** A dashboard widget surface shared by the Insights view and the admin panel. */
export default function DashboardPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-lg border border-border-light bg-surface-primary p-5',
        /** Dark mode only: Click UI gives dashboard widgets their own surface and
         *  stroke, a step lighter than the page behind them. Light mode keeps the
         *  shared surface/border tokens. */
        'dark:border-chart-widget-stroke dark:bg-chart-widget-surface',
        className,
      )}
    >
      {children}
    </section>
  );
}
