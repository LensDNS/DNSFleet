import { en, type LocaleKey } from "./locales/en";
import { zh } from "./locales/zh";

export type AppLocale = "en" | "zh";

/** BCP 47 tag for `Date#toLocaleString` (matches UI language). */
export function intlLocaleTag(locale: AppLocale): string {
  return locale === "zh" ? "zh-CN" : "en-US";
}

/** `<html lang>` for accessibility (separate from {@link intlLocaleTag} date formatting). */
export function documentHtmlLang(locale: AppLocale): string {
  return locale === "zh" ? "zh-Hans" : "en-US";
}

const STORAGE_KEY = "dnsfleet-locale";

/** Same-tab updates (storage events only fire across tabs). */
const LOCALE_CHANGE_EVENT = "dnsfleet-locale-change";

export function readStoredLocale(): AppLocale | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "zh" || raw === "en") return raw;
  } catch {
    // ignore
  }
  return null;
}

/** Snapshot for useSyncExternalStore (client). */
export function getLocaleStoreSnapshot(): AppLocale {
  return readStoredLocale() ?? "en";
}

export function subscribeStoredLocale(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) onStoreChange();
  };
  const onLocal = () => onStoreChange();
  window.addEventListener("storage", onStorage);
  window.addEventListener(LOCALE_CHANGE_EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LOCALE_CHANGE_EVENT, onLocal);
  };
}

export function writeStoredLocale(locale: AppLocale): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
  } catch {
    // ignore
  }
}

function lastSegment(key: string): string {
  const i = key.lastIndexOf(".");
  return i >= 0 ? key.slice(i + 1) : key;
}

/** Resolve message: active locale → en → last dot segment of key (never empty). */
export function resolveMessage(
  key: LocaleKey,
  locale: AppLocale,
  zhTable: Record<LocaleKey, string> = zh,
): string {
  const enVal = en[key];
  const primary = locale === "zh" ? zhTable[key] : enVal;
  if (typeof primary === "string" && primary.length > 0) return primary;
  if (typeof enVal === "string" && enVal.length > 0) return enVal;
  const seg = lastSegment(key);
  return seg.length > 0 ? seg : key;
}

/** Replace `{name}`-style placeholders once (simple; no nesting). */
export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}
