/**
 * REST base for browser calls. With default Next rewrites, use relative `/api/v1`
 * so requests stay same-origin and are proxied to Echo (see web/README.md).
 *
 * NEXT_PUBLIC_API_BASE: unset or empty string `''` means use `/api/v1`.
 * Do not use `if (!base)` alone — treat empty string explicitly.
 *
 * SECURITY: Never set NEXT_PUBLIC_API_BASE to the backend origin (e.g. http://127.0.0.1:8080)
 * when using the rewrite strategy — that bypasses the proxy and triggers CORS.
 * Only set an absolute URL if you intentionally use Echo CORS + direct browser calls.
 */
export function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE;
  if (raw === undefined || raw === "") {
    return "/api/v1";
  }
  return raw.replace(/\/+$/, "");
}

/**
 * DEV ONLY: Admin token is embedded in the client bundle via NEXT_PUBLIC_*.
 * Must match control plane DNSFLEET_ADMIN_TOKEN. Do not use as sole production auth.
 */
export function getAdminToken(): string | undefined {
  const t = process.env.NEXT_PUBLIC_DNSFLEET_ADMIN_TOKEN;
  if (t === undefined || t === "") {
    return undefined;
  }
  return t;
}

export type ApiFetchInit = RequestInit & {
  /** If false, skip Authorization (e.g. INSECURE_DISABLE smoke). Default true when token set. */
  auth?: boolean;
};

/**
 * Same-origin fetch against the REST base from {@link getApiBase}.
 *
 * **Path:** pass segments *under* the API base, e.g. `"/nodes"` or `"nodes"`, not `"/api/v1/nodes"`
 * — the latter would become `/api/v1/api/v1/nodes`. Absolute `http(s)://…` is passed through unchanged.
 */
export async function apiFetch(
  path: string,
  init: ApiFetchInit = {},
): Promise<Response> {
  const base = getApiBase();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const token = getAdminToken();
  const { auth = true, headers: hdrs, ...rest } = init;
  const headers = new Headers(hdrs);
  if (auth && token) {
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  return fetch(url, { ...rest, headers });
}
