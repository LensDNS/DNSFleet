"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { LocaleKey } from "./locales/en";
import type { AppLocale } from "./resolve-message";
import {
  documentHtmlLang,
  getLocaleStoreSnapshot,
  resolveMessage,
  subscribeStoredLocale,
  writeStoredLocale,
} from "./resolve-message";

type LocaleContextValue = {
  locale: AppLocale;
  setLocale: (next: AppLocale) => void;
  t: (key: LocaleKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore<AppLocale>(
    subscribeStoredLocale,
    getLocaleStoreSnapshot,
    () => "en",
  );

  useEffect(() => {
    document.documentElement.lang = documentHtmlLang(locale);
  }, [locale]);

  const setLocale = useCallback((next: AppLocale) => {
    writeStoredLocale(next);
  }, []);

  const t = useCallback(
    (key: LocaleKey) => resolveMessage(key, locale),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return ctx;
}
