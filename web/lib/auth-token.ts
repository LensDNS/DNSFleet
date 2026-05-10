/** sessionStorage key for Admin token (Step 6). */
export const SESSION_ADMIN_TOKEN_KEY = "dnsfleet_admin_token";

export function getSessionStoredToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const v = sessionStorage.getItem(SESSION_ADMIN_TOKEN_KEY);
  if (v === null || v.trim() === "") return undefined;
  return v;
}

export function setSessionStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_ADMIN_TOKEN_KEY, token.trim());
}

export function clearSessionStoredToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_ADMIN_TOKEN_KEY);
}

/**
 * Skip Admin auth in the browser (must pair with control plane
 * DNSFLEET_ADMIN_INSECURE_DISABLE). Next injects string; only "1" is true.
 */
export function isSkipAdminAuth(): boolean {
  return process.env.NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH === "1";
}

/**
 * Effective Admin token: **sessionStorage first**, then
 * NEXT_PUBLIC_DNSFLEET_ADMIN_TOKEN. When {@link isSkipAdminAuth} is true,
 * callers must still not attach credentials to REST/WS (see apiFetch / WS URL).
 */
export function getAdminToken(): string | undefined {
  if (typeof window !== "undefined") {
    const s = getSessionStoredToken();
    if (s !== undefined) return s;
  }
  const env = process.env.NEXT_PUBLIC_DNSFLEET_ADMIN_TOKEN;
  if (env !== undefined && env !== "") return env;
  return undefined;
}

/** Gate: can access dashboard without login page. */
export function hasDashboardAccess(): boolean {
  if (isSkipAdminAuth()) return true;
  return getAdminToken() !== undefined;
}
