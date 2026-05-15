import { apiFetch, readErrorMessage, readJsonBody } from "@/lib/api";
import type { NodeDTO } from "@/lib/dnsfleet-types";

/** Admin `POST /api/v1/nodes/:id/probe` — dedicated probe route (uses AdGHSem server-side). */
export function probeNode(id: number): Promise<Response> {
  return apiFetch(`/nodes/${id}/probe`, { method: "POST" });
}

export type ProbeNodeResult = {
  ok: boolean;
  status: number;
  node: NodeDTO | null;
  message: string;
};

/** Probe one node; returns updated `NodeDTO` (200 body or 422 `node` field) when available. */
export async function probeNodeDto(id: number): Promise<ProbeNodeResult> {
  const res = await probeNode(id);
  const data = await readJsonBody<Partial<NodeDTO> & { node?: NodeDTO; message?: string }>(res);
  let node: NodeDTO | null = null;
  if (data && typeof data === "object") {
    if (data.node && typeof data.node.id === "number") {
      node = data.node;
    } else if (typeof data.id === "number") {
      node = data as NodeDTO;
    }
  }
  const message =
    data && typeof data.message === "string" && data.message !== ""
      ? data.message
      : res.ok
        ? ""
        : await readErrorMessage(res);
  return { ok: res.ok, status: res.status, node, message };
}

/**
 * Run async work over items with bounded concurrency (pool size >= 1).
 * Order of completion is not preserved in results array index (results align with input index).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);

  async function worker(): Promise<void> {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]!, idx);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
