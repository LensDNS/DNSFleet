import {
  clearSessionStoredToken,
  getAdminToken,
  isSkipAdminAuth,
} from "@/lib/auth-token";
import { getLocaleStoreSnapshot, resolveMessage } from "@/lib/i18n/resolve-message";

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

export type ApiFetchInit = Omit<RequestInit, "body"> & {
  /**
   * If false, skip Authorization (e.g. INSECURE_DISABLE smoke).
   * When {@link isSkipAdminAuth} is true, Authorization is never sent regardless of this flag.
   */
  auth?: boolean;
  /** Plain objects/arrays are JSON-encoded (see {@link apiFetch}). */
  body?: RequestInit["body"] | Record<string, unknown> | unknown[] | null;
};

type ApiJsonBody = RequestInit["body"] | Record<string, unknown> | unknown[] | null;

function shouldAttachJsonBody(
  body: ApiJsonBody | undefined,
): body is Record<string, unknown> | unknown[] {

  if (body === null || body === undefined) return false;
  if (typeof body === "string") return false;
  if (body instanceof FormData) return false;
  if (body instanceof Blob) return false;
  if (body instanceof ArrayBuffer) return false;
  if (body instanceof URLSearchParams) return false;
  return typeof body === "object";
}

/**
 * Same-origin fetch against the REST base from {@link getApiBase}.
 *
 * **Path:** pass segments *under* the API base, e.g. `"/nodes"` or `"nodes"`, not `"/api/v1/nodes"`
 * — the latter would become `/api/v1/api/v1/nodes`. Absolute `http(s)://…` is passed through unchanged.
 *
 * **SKIP_ADMIN_AUTH:** never sends `Authorization` / `X-Admin-Token` (even if `auth: true`).
 * **JSON body:** plain objects/arrays are `JSON.stringify`'d and `Content-Type: application/json` set.
 * **Errors:** On SKIP mode, this helper already toasts on **401**; callers that also `toast.error` on `!res.ok` must guard with {@link shouldSkipDuplicate401Toast} first.
 */
export async function apiFetch(
  path: string,
  init: ApiFetchInit = {},
): Promise<Response> {
  const base = getApiBase();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const { auth = true, headers: hdrs, body: rawBody, ...rest } = init;
  const headers = new Headers(hdrs);
  let body: BodyInit | undefined = rawBody as BodyInit | undefined;

  if (shouldAttachJsonBody(rawBody)) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    body = JSON.stringify(rawBody);
  }

  const skip = isSkipAdminAuth();
  if (skip) {
    headers.delete("Authorization");
    headers.delete("X-Admin-Token");
  }
  const token = getAdminToken();
  if (!skip && auth !== false && token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, { ...rest, headers, body });

  if (res.status === 401 && typeof window !== "undefined") {
    if (isSkipAdminAuth()) {
      void readErrorMessage(res.clone()).then((msg) => {
        void import("sonner").then(({ toast }) => {
          toast.error(msg);
        });
      });
    } else {
      clearSessionStoredToken();
      window.location.assign("/login");
    }
  }

  if (res.status === 429 && typeof window !== "undefined") {
    void import("sonner").then(({ toast }) => {
      toast.warning(resolveMessage("api.rateLimited", getLocaleStoreSnapshot()));
    });
  }

  return res;
}

/**
 * SKIP 模式下 {@link apiFetch} 已对 401 弹出过一次 Toast；调用方对同一响应不要再 `toast.error`，否则会重复。
 */
export function shouldSkipDuplicate401Toast(res: Response): boolean {
  return isSkipAdminAuth() && res.status === 401;
}

/** Same-origin `GET /healthz` — not under `/api/v1`; do not send Admin headers. */
export function fetchHealthz(init: RequestInit = {}): Promise<Response> {
  return fetch("/healthz", { ...init });
}

/**
 * Parse JSON response body; **204** and empty body return `null`.
 * Throws if body is non-empty but invalid JSON.
 */
export async function readJsonBody<T = unknown>(
  res: Response,
): Promise<T | null> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (text.trim() === "") return null;
  return JSON.parse(text) as T;
}

/**
 * Try to read `{ message?: string }` from error responses.
 */
export async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await readJsonBody<{ message?: string }>(res)) as {
      message?: string;
    } | null;
    if (data?.message) return data.message;
  } catch {
    // ignore
  }
  return res.statusText || `HTTP ${res.status}`;
}

export {
  clearSessionStoredToken,
  getAdminToken,
  hasDashboardAccess,
  isSkipAdminAuth,
  SESSION_ADMIN_TOKEN_KEY,
  setSessionStoredToken,
} from "./auth-token";
