import { useId, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Label, Input, Button, Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { AdminUserSearchResult } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { useAdminUserSearchQuery } from '~/data-provider';
import { useLocalize, useDebounce } from '~/hooks';
import { useAdminFormat } from './format';

/** A labelled form row; `hint` renders under the control and is linked for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id, describedBy)}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-text-destructive">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-text-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="ps-9"
      />
    </div>
  );
}

/** Offset pagination footer: range summary and previous/next (arrows mirror in RTL). */
export function Pager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const localize = useLocalize();
  const format = useAdminFormat();
  if (total <= limit && offset === 0) {
    return null;
  }
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav
      aria-label={localize('com_admin_pagination')}
      className="mt-4 flex items-center justify-between gap-3 text-sm text-text-secondary"
    >
      <span>
        {localize('com_admin_pagination_range', {
          0: format.number(from),
          1: format.number(to),
          2: format.number(total),
        })}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
          aria-label={localize('com_admin_previous')}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={to >= total}
          onClick={() => onChange(offset + limit)}
          aria-label={localize('com_admin_next')}
        >
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

/** A confirmation dialog for destructive or sensitive actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isLoading,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  isLoading?: boolean;
  destructive?: boolean;
}) {
  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={title}
        className="max-w-md"
        main={<p className="text-sm text-text-secondary">{description}</p>}
        selection={
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? <Spinner className="size-4" /> : confirmLabel}
          </Button>
        }
      />
    </OGDialog>
  );
}

export type PickedUser = Pick<AdminUserSearchResult, 'id' | 'name' | 'email'>;

/** Searches users (2+ characters) and lets the admin pick one or several. */
export function UserPicker({
  selected,
  onChange,
  multiple = true,
  label,
}: {
  selected: PickedUser[];
  onChange: (users: PickedUser[]) => void;
  multiple?: boolean;
  label: string;
}) {
  const localize = useLocalize();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const search = useAdminUserSearchQuery(debounced);
  const listId = useId();
  const selectedIds = new Set(selected.map((user) => user.id));
  const results = (search.data?.users ?? []).filter((user) => !selectedIds.has(user.id));

  const add = (user: PickedUser) => {
    onChange(multiple ? [...selected, user] : [user]);
    setQuery('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={localize('com_admin_user_search_placeholder')}
          aria-label={label}
          aria-controls={listId}
        />
        {search.isFetching && (
          <Spinner className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
        )}
      </div>
      {debounced.trim().length >= 2 && (
        <ul
          id={listId}
          className="max-h-48 overflow-y-auto rounded-lg border border-border-light"
          aria-label={localize('com_admin_search_results')}
        >
          {results.length === 0 && !search.isFetching && (
            <li className="px-3 py-2 text-sm text-text-secondary">
              {localize('com_admin_no_results')}
            </li>
          )}
          {results.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-start hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                onClick={() => add(user)}
              >
                <span className="text-sm text-text-primary">{user.name || user.email}</span>
                <span className="text-xs text-text-secondary" dir="ltr">
                  {user.email}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {selected.map((user) => (
            <li
              key={user.id}
              className="flex items-center gap-1 rounded-full border border-border-light bg-surface-tertiary py-0.5 pe-1 ps-3 text-xs text-text-primary"
            >
              <span>{user.name || user.email}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-surface-hover"
                onClick={() => onChange(selected.filter((item) => item.id !== user.id))}
                aria-label={localize('com_admin_remove_item', { 0: user.name || user.email })}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
