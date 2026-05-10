import { getAdminToken, isSkipAdminAuth } from "@/lib/auth-token";

/**
 * Same-origin WebSocket URL for `/api/v1/ws/logs`.
 * SKIP mode: never append `token=` (even if session holds a token).
 * Otherwise: requires a non-empty admin token from {@link getAdminToken}.
 */
export function buildLogsWebSocketUrl(): string | null {
  if (typeof window === "undefined") return null;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const path = "/api/v1/ws/logs";
  if (isSkipAdminAuth()) {
    return `${proto}//${host}${path}`;
  }
  const token = getAdminToken();
  if (!token) return null;
  return `${proto}//${host}${path}?token=${encodeURIComponent(token)}`;
}
