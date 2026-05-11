/** Merged REST + WS list cap; overflow drops oldest (tail of newest-first array). */
export const MAX_MERGED_LOG_LINES = 500;

/** If a node's newest row is still this far behind the global oldest row, pause its `older_than` chain. */
export const NODE_DEEP_PAUSE_GAP_MS = 3600 * 1000;

export type LogRowSortable = {
  timeMs: number;
  nodeId: number;
  dedupeKey: string;
};

export function compareLogRowsNewestFirst(a: LogRowSortable, b: LogRowSortable): number {
  if (b.timeMs !== a.timeMs) return b.timeMs - a.timeMs;
  if (b.nodeId !== a.nodeId) return b.nodeId - a.nodeId;
  return a.dedupeKey.localeCompare(b.dedupeKey);
}

/** Merge `incoming` into `rows`, dedupe by `dedupeKey`, sort newest-first, cap length. */
export function mergeSortedDedupeRows<T extends LogRowSortable>(rows: T[], incoming: T[]): T[] {
  const keys = new Set(rows.map((r) => r.dedupeKey));
  const out = [...rows];
  for (const r of incoming) {
    if (keys.has(r.dedupeKey)) continue;
    keys.add(r.dedupeKey);
    out.push(r);
  }
  out.sort(compareLogRowsNewestFirst);
  if (out.length > MAX_MERGED_LOG_LINES) {
    return out.slice(0, MAX_MERGED_LOG_LINES);
  }
  return out;
}

function mergeTwoSortedNewestFirst<T extends LogRowSortable>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (compareLogRowsNewestFirst(a[i]!, b[j]!) <= 0) {
      out.push(a[i]!);
      i++;
    } else {
      out.push(b[j]!);
      j++;
    }
  }
  while (i < a.length) {
    out.push(a[i]!);
    i++;
  }
  while (j < b.length) {
    out.push(b[j]!);
    j++;
  }
  return out;
}

/**
 * WS hot path: `prev` is already newest-first; `incoming` may be out of order.
 * Dedupes against `prev`, sorts the fresh rows only, then linear-merge with `prev` (no full-table sort).
 */
export function mergeNewestFirstDedupeIncremental<T extends LogRowSortable>(
  prev: T[],
  incoming: T[],
): T[] {
  const prevKeys = new Set(prev.map((r) => r.dedupeKey));
  const fresh: T[] = [];
  const seenFresh = new Set<string>();
  for (const r of incoming) {
    if (prevKeys.has(r.dedupeKey)) continue;
    if (seenFresh.has(r.dedupeKey)) continue;
    seenFresh.add(r.dedupeKey);
    fresh.push(r);
  }
  if (fresh.length === 0) return prev;
  fresh.sort(compareLogRowsNewestFirst);
  let merged = mergeTwoSortedNewestFirst(prev, fresh);
  if (merged.length > MAX_MERGED_LOG_LINES) {
    merged = merged.slice(0, MAX_MERGED_LOG_LINES);
  }
  return merged;
}

/**
 * Per-node deep pagination pause: if this node's newest row is still far older than
 * the **oldest** row among **other** nodes, pause `older_than` for this node.
 */
export function recomputePausedDeep(rows: { nodeId: number; timeMs: number }[]): Record<number, boolean> {
  if (rows.length === 0) return {};
  const perNodeMin = new Map<number, number>();
  const perNodeMax = new Map<number, number>();
  for (const r of rows) {
    const t = r.timeMs;
    const prevMin = perNodeMin.get(r.nodeId);
    perNodeMin.set(r.nodeId, prevMin === undefined ? t : Math.min(prevMin, t));
    const prevMax = perNodeMax.get(r.nodeId);
    perNodeMax.set(r.nodeId, prevMax === undefined ? t : Math.max(prevMax, t));
  }
  const nodeIds = [...perNodeMax.keys()];
  const out: Record<number, boolean> = {};
  for (const nid of nodeIds) {
    const maxT = perNodeMax.get(nid)!;
    let minOthers = Infinity;
    for (const other of nodeIds) {
      if (other === nid) continue;
      const omin = perNodeMin.get(other);
      if (omin !== undefined) minOthers = Math.min(minOthers, omin);
    }
    if (!Number.isFinite(minOthers)) {
      out[nid] = false;
      continue;
    }
    out[nid] = maxT + NODE_DEEP_PAUSE_GAP_MS < minOthers;
  }
  return out;
}

export async function logRowDedupeKeyHex(nodeId: number, entry: Record<string, unknown>): Promise<string> {
  const raw = `${nodeId}\n${JSON.stringify(entry)}`;
  const buf = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
