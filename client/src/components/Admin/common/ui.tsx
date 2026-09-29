import { useCallback } from 'react';
import { AlertCircle, Inbox } from 'lucide-react';
import { Button, EmptyState, Spinner, useToastContext } from '@librechat/client';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { DashboardPanel } from '~/components/ui';
import { readApiError } from './format';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export { DashboardPanel as Panel };

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
        {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-text-primary">{children}</h2>
      {actions}
    </div>
  );
}

export function LoadingState({ className }: { className?: string }) {
  const localize = useLocalize();
  return (
    <div role="status" className={cn('flex min-h-40 items-center justify-center gap-3', className)}>
      <Spinner className="size-6 text-text-secondary" />
      <span className="text-sm text-text-secondary">{localize('com_admin_loading')}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const localize = useLocalize();
  const message = useApiErrorMessage()(error);
  return (
    <EmptyState
      icon={AlertCircle}
      title={localize('com_admin_error_title')}
      description={message}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {localize('com_admin_retry')}
          </Button>
        ) : undefined
      }
    />
  );
}

export function Empty({
  title,
  description,
  icon = Inbox,
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return <EmptyState icon={icon} title={title} description={description} action={action} />;
}

/** Wraps a query result: loading, error (with retry) and empty states, then the content. */
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  children,
}: {
  query: { data?: T; isLoading: boolean; error: unknown; refetch: () => unknown };
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) {
    return <LoadingState />;
  }
  if (query.error || query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  if (isEmpty?.(query.data) && empty) {
    return <>{empty}</>;
  }
  return <>{children(query.data)}</>;
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <DashboardPanel className="p-4">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        {Icon && <Icon className="size-4" aria-hidden="true" />}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-text-primary">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-secondary">{hint}</div>}
    </DashboardPanel>
  );
}

export function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
        active
          ? 'border-border-light text-text-primary'
          : 'border-border-medium bg-surface-tertiary text-text-secondary',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', active ? 'bg-status-success' : 'bg-status-neutral')}
      />
      {label}
    </span>
  );
}

type ListProps = { className?: string; children: ReactNode };

/**
 * A list whose rows hold links. The chat's global `li a` rule (`mobile.css`) paints any
 * anchor inside an `<li>` bold, blue and underlined, overriding the theme roles, so rows
 * carry the list semantics through ARIA roles instead of `<ul>`/`<li>`.
 */
export function LinkList({ className, children }: ListProps) {
  return (
    <div role="list" className={className}>
      {children}
    </div>
  );
}

export function LinkListItem({ className, children }: ListProps) {
  return (
    <div role="listitem" className={className}>
      {children}
    </div>
  );
}

/** Maps a failed admin call to a message in the panel's language. */
export function useApiErrorMessage(): (error: unknown) => string {
  const localize = useLocalize();
  return useCallback(
    (error: unknown) => {
      const { status } = readApiError(error);
      switch (status) {
        case 400:
          return localize('com_admin_error_invalid');
        case 401:
          return localize('com_admin_error_session');
        case 403:
          return localize('com_admin_error_forbidden');
        case 404:
          return localize('com_admin_error_not_found');
        case 409:
          return localize('com_admin_error_conflict');
        default:
          return localize('com_admin_error_generic');
      }
    },
    [localize],
  );
}

/** Success/error toasts for admin mutations, with the server detail appended on errors. */
export function useAdminNotify() {
  const { showToast } = useToastContext();
  const toMessage = useApiErrorMessage();
  return {
    success: (message: string) => showToast({ message, status: 'success' }),
    failure: (message: string) => showToast({ message, status: 'error' }),
    error: (error: unknown) => {
      const { detail } = readApiError(error);
      const message = toMessage(error);
      showToast({ message: detail ? `${message} (${detail})` : message, status: 'error' });
    },
  };
}
