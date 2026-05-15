import { apiFetch, readErrorMessage, readJsonBody } from "@/lib/api";
import type { NodeDTO } from "@/lib/dnsfleet-types";

/**
 * Consecutive REST querylog failures before POST mark-offline.
 * Keep in sync with internal/querylog/hub.go (pollFailMarkOfflineAfter) and api/DNSFLEET_HTTP_API.md (POST .../mark-offline).
 */
export const LIVE_LOGS_QUERYLOG_FAIL_THRESHOLD = 3;

export async function markNodeOfflineApi(nodeId: number): Promise<NodeDTO | null> {
  const res = await apiFetch(`/nodes/${nodeId}/mark-offline`, { method: "POST" });
  const data = await readJsonBody<Partial<NodeDTO> & { node?: NodeDTO }>(res);
  if (!res.ok) {
    throw new Error(
      (data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : null) ?? (await readErrorMessage(res)),
    );
  }
  if (data && typeof data === "object" && typeof data.id === "number") {
    return data as NodeDTO;
  }
  return null;
}

export class QuerylogFailureTracker {
  private readonly counts = new Map<number, number>();

  /** Returns true when threshold reached and mark-offline was triggered. */
  async recordFailure(
    nodeId: number,
    onMarkedOffline: (updated: NodeDTO | null) => void,
  ): Promise<boolean> {
    const next = (this.counts.get(nodeId) ?? 0) + 1;
    this.counts.set(nodeId, next);
    if (next < LIVE_LOGS_QUERYLOG_FAIL_THRESHOLD) {
      return false;
    }
    this.counts.delete(nodeId);
    try {
      const updated = await markNodeOfflineApi(nodeId);
      onMarkedOffline(updated);
      return true;
    } catch {
      return false;
    }
  }

  clear(nodeId: number): void {
    this.counts.delete(nodeId);
  }
}
