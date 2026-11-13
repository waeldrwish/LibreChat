import { I18nextProvider } from 'react-i18next';
import type { TStartupConfig } from 'librechat-data-provider';
import * as endpointQueries from '~/data-provider/Endpoints/queries';
import * as miscDataProvider from '~/data-provider/Misc/queries';
import { render, screen } from 'test/layout-test-utils';
import AuthLayout from '~/components/Auth/AuthLayout';
import i18n from '~/locales/i18n';

const policies = {
  privacyPolicy: { externalUrl: 'https://example.com/privacy' },
  termsOfService: { externalUrl: 'https://example.com/terms' },
};

function setup(pathname: string) {
  const startupConfig = {
    appTitle: 'LibreChat',
    serverDomain: 'mock-server',
    interface: policies,
  } as unknown as TStartupConfig;

  jest
    .spyOn(endpointQueries, 'useGetStartupConfig')
    //@ts-ignore - the layout reads only the resolved data
    .mockReturnValue({ data: startupConfig, isFetching: false, isError: false });
  jest
    .spyOn(miscDataProvider, 'useGetBannerQuery')
    //@ts-ignore - the banner is not under test
    .mockReturnValue({ data: null, isLoading: false, isError: false });

  return render(
    <I18nextProvider i18n={i18n}>
      <AuthLayout
        startupConfig={startupConfig}
        isFetching={false}
        error={null}
        startupConfigError={null}
        header="Sign in"
        pathname={pathname}
      >
        <form aria-label="Authentication form" />
      </AuthLayout>
    </I18nextProvider>,
  );
}

describe('AuthLayout legal UI', () => {
  test('does not render policy links, consent text, or footer on login', () => {
    setup('login');

    expect(screen.queryByText(/By continuing/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /privacy policy/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /terms of service/i })).not.toBeInTheDocument();
    expect(document.querySelector('[role="contentinfo"]')).toBeNull();
  });

  test('does not render policy links, consent text, or footer on the second-factor screen', () => {
    setup('login/2fa');

    expect(screen.queryByText(/By continuing/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /privacy policy/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /terms of service/i })).not.toBeInTheDocument();
    expect(document.querySelector('[role="contentinfo"]')).toBeNull();
  });
});
