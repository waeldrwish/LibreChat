import { useEffect, useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ADMIN_PANEL_LANGUAGE_USER } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import i18n, { ensureLocale, normalizeLocale } from '~/locales/i18n';

/**
 * Renders the admin panel in its configured language without changing the rest of
 * the app: a clone of the app's i18n instance shares the loaded bundles but keeps its
 * own language. The document direction and language follow the panel while it is
 * mounted, so dialogs and menus portalled to `<body>` read in the same direction.
 */
export default function AdminLocale({
  language,
  children,
}: {
  language: string;
  children: (locale: string) => ReactNode;
}) {
  const requested =
    language === ADMIN_PANEL_LANGUAGE_USER
      ? normalizeLocale(i18n.language)
      : normalizeLocale(language);
  const instance = useMemo(() => i18n.cloneInstance({ lng: requested }), [requested]);
  const [locale, setLocale] = useState<string>(requested);

  useEffect(() => {
    let cancelled = false;
    ensureLocale(requested).then(async (loaded) => {
      await instance.changeLanguage(loaded);
      if (!cancelled) {
        setLocale(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [instance, requested]);

  useEffect(() => {
    const root = document.documentElement;
    const previous = { dir: root.dir, lang: root.lang };
    root.dir = i18n.dir(locale);
    root.lang = locale;
    return () => {
      root.dir = previous.dir;
      root.lang = previous.lang;
    };
  }, [locale]);

  return <I18nextProvider i18n={instance}>{children(locale)}</I18nextProvider>;
}
