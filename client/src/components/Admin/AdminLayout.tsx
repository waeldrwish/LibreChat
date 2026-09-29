import { useEffect, useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { Menu, ArrowRight, ShieldAlert } from 'lucide-react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AdminContextProvider, useAdmin } from './context';
import { useDocumentTitle, useLocalize } from '~/hooks';
import { useAdminSessionQuery } from '~/data-provider';
import AdminLocale from './AdminLocale';
import { Empty } from './common/ui';
import { ADMIN_NAV } from './nav';
import { cn } from '~/utils';

function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const localize = useLocalize();
  const { can } = useAdmin();
  return (
    <nav aria-label={localize('com_admin_title')} className="flex flex-col gap-5 p-3">
      {ADMIN_NAV.map((section) => {
        const items = section.items.filter((item) => can(...item.anyOf));
        if (items.length === 0) {
          return null;
        }
        return (
          <div key={section.labelKey}>
            <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              {localize(section.labelKey)}
            </p>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === ''}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-theme-fast motion-reduce:transition-none',
                        isActive
                          ? 'bg-surface-active text-text-primary'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden="true" />
                    <span>{localize(item.labelKey)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function AdminShell() {
  const localize = useLocalize();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useDocumentTitle(localize('com_admin_title'));

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className="flex h-dvh w-full flex-col bg-presentation text-text-primary">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border-light px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label={localize('com_admin_open_menu')}
          aria-expanded={drawerOpen}
          aria-controls="admin-sidebar"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
        <h1 className="text-base font-semibold">{localize('com_admin_title')}</h1>
        <div className="flex-1" />
        <Button asChild variant="outline" size="sm">
          <Link to="/c/new">
            <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
            <span>{localize('com_admin_back_to_chat')}</span>
          </Link>
        </Button>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {drawerOpen && (
          <button
            type="button"
            className="fixed inset-0 z-20 bg-surface-overlay/65 md:hidden"
            aria-label={localize('com_admin_close_menu')}
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <aside
          id="admin-sidebar"
          className={cn(
            'z-30 w-64 shrink-0 overflow-y-auto border-e border-border-light bg-surface-primary-alt',
            'motion-reduce:transition-none max-md:fixed max-md:inset-y-0 max-md:start-0 max-md:top-14 max-md:transition-transform max-md:duration-theme-normal',
            drawerOpen
              ? 'max-md:translate-x-0'
              : 'max-md:-translate-x-full max-md:rtl:translate-x-full',
          )}
        >
          <AdminSidebar onNavigate={() => setDrawerOpen(false)} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function AdminDenied() {
  const localize = useLocalize();
  return (
    <div className="flex h-dvh items-center justify-center bg-presentation p-6">
      <Empty
        icon={ShieldAlert}
        title={localize('com_admin_denied_title')}
        description={localize('com_admin_denied_description')}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/c/new">{localize('com_admin_back_to_chat')}</Link>
          </Button>
        }
      />
    </div>
  );
}

/**
 * The in-app admin panel. The server decides access (`/api/admin/panel/session`);
 * every admin API enforces its own capability, so hiding a section here is only
 * presentation.
 */
export default function AdminLayout() {
  const session = useAdminSessionQuery();

  if (session.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-presentation">
        <Spinner className="size-8 text-text-secondary" />
      </div>
    );
  }
  if (session.error || !session.data) {
    return <Navigate to="/c/new" replace={true} />;
  }
  const data = session.data;

  return (
    <AdminLocale language={data.language}>
      {(locale) => (
        <AdminContextProvider session={data} locale={locale}>
          {data.access ? <AdminShell /> : <AdminDenied />}
        </AdminContextProvider>
      )}
    </AdminLocale>
  );
}
