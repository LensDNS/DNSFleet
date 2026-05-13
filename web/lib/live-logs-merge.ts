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

/** Dedupe keys from rows without allocating an intermediate string array (hot path). */
export function dedupeKeySetFromRows<T extends LogRowSortable>(rows: T[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    s.add(rows[i].dedupeKey);
  }
  return s;
}

/** Both inputs sorted newest-first by {@link compareLogRowsNewestFirst}; output merged same order. */
function mergeSortedArraysNewestFirst<T extends LogRowSortable>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (compareLogRowsNewestFirst(a[i], b[j]) <= 0) {
      out.push(a[i++]);
    } else {
      out.push(b[j++]);
    }
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

/** Both inputs sorted newest-first by {@link compareLogRowsNewestFirstWithSkew}. */
function mergeSortedArraysNewestFirstWithSkew<T extends LogRowSortable>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (compareLogRowsNewestFirstWithSkew(a[i], b[j]) <= 0) {
      out.push(a[i++]);
    } else {
      out.push(b[j++]);
    }
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

/**
 * Merge `incoming` into `rows`, dedupe by `dedupeKey`, cap length.
 * **Contract:** `rows` must already be sorted newest-first by {@link compareLogRowsNewestFirst}
 * (e.g. prior return value of this function, or `[]`). Deduped newcomers are sorted, then linearly merged with `rows`.
 */
export function mergeSortedDedupeRows<T extends LogRowSortable>(rows: T[], incoming: T[]): T[] {
  const keys = rows.length === 0 ? new Set<string>() : dedupeKeySetFromRows(rows);
  const add: T[] = [];
  for (const r of incoming) {
    if (keys.has(r.dedupeKey)) continue;
    keys.add(r.dedupeKey);
    add.push(r);
  }
  if (add.length === 0) {
    return rows.length <= MAX_MERGED_LOG_LINES ? rows : rows.slice(0, MAX_MERGED_LOG_LINES);
  }
  add.sort(compareLogRowsNewestFirst);
  const merged = mergeSortedArraysNewestFirst(rows, add);
  if (merged.length > MAX_MERGED_LOG_LINES) {
    return merged.slice(0, MAX_MERGED_LOG_LINES);
  }
  return merged;
}

/**
 * WS hot path: `prev` is already newest-first by {@link compareLogRowsNewestFirstWithSkew}; `incoming` may be out of order.
 * Dedupes against `prev`, sorts only the new `fresh` rows with {@link compareLogRowsNewestFirstWithSkew},
 * linearly merges with `prev`, then caps (no full-table sort of `prev ∪ fresh`).
 */
export function mergeNewestFirstDedupeIncremental<T extends LogRowSortable>(
  prev: T[],
  incoming: T[],
): T[] {
  const prevKeys = prev.length === 0 ? new Set<string>() : dedupeKeySetFromRows(prev);
  const fresh: T[] = [];
  const seenFresh = new Set<string>();
  for (const r of incoming) {
    if (prevKeys.has(r.dedupeKey)) continue;
    if (seenFresh.has(r.dedupeKey)) continue;
    seenFresh.add(r.dedupeKey);
    fresh.push(r);
  }
  if (fresh.length === 0) return prev;
  const sortedFresh = [...fresh].sort(compareLogRowsNewestFirstWithSkew);
  const merged = mergeSortedArraysNewestFirstWithSkew(prev, sortedFresh);
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
