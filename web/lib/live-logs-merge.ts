/** Merged REST + WS list cap; overflow drops oldest (tail of newest-first array). */
export const MAX_MERGED_LOG_LINES = 500;

/** If a node's newest row is still this far behind the global oldest row, pause its `older_than` chain. */
export const NODE_DEEP_PAUSE_GAP_MS = 3600 * 1000;

/**
 * When two rows' `entry.time` differ by at most this many ms, merge treats them as the same time band
 * and orders by `receivedAt` (newest delivery first) before node/dedupe tie-breaks — not strict wall-clock order.
 */
export const WS_TIME_REORDER_SKEW_MS = 1500;

/** Dedupe key when server sends `fingerprint` (SHA-256 hex of upstream entry JSON bytes); scoped by node. */
export function logRowDedupeKeyFromWsFingerprint(nodeId: number, fingerprint: string): string {
  return `${nodeId}\n${fingerprint}`;
}

const WS_FINGERPRINT_HEX_RE = /^[0-9a-f]{64}$/i;

export function isWsFingerprintHex(s: string): boolean {
  return WS_FINGERPRINT_HEX_RE.test(s);
}

export type LogRowSortable = {
  timeMs: number;
  nodeId: number;
  dedupeKey: string;
  /** Wall receive time (browser); used with {@link WS_TIME_REORDER_SKEW_MS} for merge ordering only. */
  receivedAt?: number;
};

export function compareLogRowsNewestFirst(a: LogRowSortable, b: LogRowSortable): number {
  if (b.timeMs !== a.timeMs) return b.timeMs - a.timeMs;
  if (b.nodeId !== a.nodeId) return b.nodeId - a.nodeId;
  return a.dedupeKey.localeCompare(b.dedupeKey);
}

/** Newest-first with a small time skew window (see {@link WS_TIME_REORDER_SKEW_MS}). */
export function compareLogRowsNewestFirstWithSkew(a: LogRowSortable, b: LogRowSortable): number {
  if (Math.abs(a.timeMs - b.timeMs) <= WS_TIME_REORDER_SKEW_MS) {
    const ra = a.receivedAt ?? 0;
    const rb = b.receivedAt ?? 0;
    if (rb !== ra) return rb - ra;
  }
  return compareLogRowsNewestFirst(a, b);
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

/**
 * WS hot path: `prev` is already newest-first; `incoming` may be out of order.
 * Dedupes against `prev`, then sorts `prev ∪ fresh` with {@link compareLogRowsNewestFirstWithSkew} and caps.
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
  const merged = [...prev, ...fresh];
  merged.sort(compareLogRowsNewestFirstWithSkew);
  if (merged.length > MAX_MERGED_LOG_LINES) {
    return merged.slice(0, MAX_MERGED_LOG_LINES);
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
