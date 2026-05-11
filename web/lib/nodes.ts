import { apiFetch } from "@/lib/api";

/** Admin `POST /api/v1/nodes/:id/probe` — dedicated probe route (uses AdGHSem server-side). */
export function probeNode(id: number): Promise<Response> {
  return apiFetch(`/nodes/${id}/probe`, { method: "POST" });
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
