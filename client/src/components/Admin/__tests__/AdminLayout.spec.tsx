import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { TAdminSession } from 'librechat-data-provider';
import { __setLocaleLoaderForTests } from '~/locales/i18n';
import arabic from '~/locales/ar/translation.json';
import AdminLayout from '../AdminLayout';

/** The shared test setup stubs `useTranslation`; the panel's scoped language needs the real provider. */
jest.mock('react-i18next', () => jest.requireActual('react-i18next'));

__setLocaleLoaderForTests('ar', () => Promise.resolve({ default: arabic }));

let mockSession: { data?: TAdminSession; isLoading: boolean; error: unknown } = {
  isLoading: true,
  error: null,
};

jest.mock('~/data-provider', () => ({
  useAdminSessionQuery: () => mockSession,
}));

function renderPanel(path = '/admin') {
  const router = createMemoryRouter(
    [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <p data-testid="overview-page" /> },
          { path: 'users', element: <p data-testid="users-page" /> },
        ],
      },
      { path: '/c/new', element: <p data-testid="chat-page" /> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

const session = (overrides: Partial<TAdminSession>): TAdminSession => ({
  enabled: true,
  access: true,
  scope: 'global',
  capabilities: ['access:admin'],
  language: 'ar',
  ...overrides,
});

describe('AdminLayout', () => {
  afterEach(() => {
    document.documentElement.dir = '';
    document.documentElement.lang = '';
  });

  it('sends a user the server does not recognize back to the chat', async () => {
    mockSession = { isLoading: false, error: new Error('401') };
    renderPanel();
    expect(await screen.findByTestId('chat-page')).toBeInTheDocument();
  });

  it('explains that the panel is not available without admin access', async () => {
    mockSession = {
      isLoading: false,
      error: null,
      data: session({ access: false, scope: 'none', capabilities: [] }),
    };
    renderPanel();
    expect(await screen.findByText('لا تملك صلاحية الوصول إلى لوحة الإدارة')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-page')).not.toBeInTheDocument();
  });

  it('renders right-to-left in Arabic and restores the document direction on unmount', async () => {
    document.documentElement.dir = 'ltr';
    mockSession = {
      isLoading: false,
      error: null,
      data: session({ capabilities: ['access:admin', 'read:users', 'read:usage'] }),
    };
    const { unmount } = renderPanel();
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(document.documentElement.lang).toBe('ar');
    expect(await screen.findByRole('link', { name: 'المستخدمون' })).toBeInTheDocument();
    unmount();
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('only lists the sections the viewer holds a capability for', async () => {
    mockSession = {
      isLoading: false,
      error: null,
      data: session({ capabilities: ['access:admin', 'read:users'] }),
    };
    renderPanel('/admin/users');
    expect(await screen.findByTestId('users-page')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'المستخدمون' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'النماذج' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'سجل العمليات' })).not.toBeInTheDocument();
  });
});
