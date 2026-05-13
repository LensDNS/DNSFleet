import { describe, expect, it } from "vitest";

import {
  compareLogRowsNewestFirst,
  compareLogRowsNewestFirstWithSkew,
  dedupeKeySetFromRows,
  MAX_MERGED_LOG_LINES,
  mergeNewestFirstDedupeIncremental,
  mergeSortedDedupeRows,
  NODE_DEEP_PAUSE_GAP_MS,
  recomputePausedDeep,
} from "./live-logs-merge";

type R = { timeMs: number; nodeId: number; dedupeKey: string; receivedAt?: number };

function mergeNewestFirstDedupeNaive(prev: R[], incoming: R[]): R[] {
  const prevKeys = prev.length === 0 ? new Set<string>() : dedupeKeySetFromRows(prev);
  const fresh: R[] = [];
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

function mergeSortedDedupeRowsNaive(rows: R[], incoming: R[]): R[] {
  const keys = rows.length === 0 ? new Set<string>() : dedupeKeySetFromRows(rows);
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

describe("mergeSortedDedupeRows", () => {
  it("sorts newest first and dedupes", () => {
    const a: R = { timeMs: 100, nodeId: 1, dedupeKey: "a" };
    const b: R = { timeMs: 200, nodeId: 1, dedupeKey: "b" };
    const c: R = { timeMs: 150, nodeId: 2, dedupeKey: "c" };
    const m = mergeSortedDedupeRows([a], [b, c, { ...b, dedupeKey: "b" }]);
    expect(m.map((x) => x.dedupeKey).join(",")).toBe("b,c,a");
  });

  it("caps length dropping oldest", () => {
    const rows: R[] = [];
    for (let i = 0; i < MAX_MERGED_LOG_LINES + 20; i++) {
      rows.push({ timeMs: 1_000_000 + i, nodeId: 1, dedupeKey: `k${i}` });
    }
    const merged = mergeSortedDedupeRows([], rows);
    expect(merged.length).toBe(MAX_MERGED_LOG_LINES);
    expect(merged[0].dedupeKey).toBe(`k${MAX_MERGED_LOG_LINES + 19}`);
  });

  it("matches naive full-sort merge for random REST-shaped batches", () => {
    let rng = 42_001;
    const rnd = () => {
      rng = (rng * 1103515245 + 12345) >>> 0;
      return rng / 0xffff_ffff;
    };
    for (let iter = 0; iter < 60; iter++) {
      const rowLen = Math.floor(rnd() * 15);
      const rows: R[] = [];
      for (let i = 0; i < rowLen; i++) {
        rows.push({
          timeMs: Math.floor(rnd() * 1e9),
          nodeId: 1 + Math.floor(rnd() * 3),
          dedupeKey: `r${iter}-${i}`,
        });
      }
      rows.sort(compareLogRowsNewestFirst);
      const incLen = Math.floor(rnd() * 10);
      const incoming: R[] = [];
      for (let i = 0; i < incLen; i++) {
        incoming.push({
          timeMs: Math.floor(rnd() * 1e9),
          nodeId: 1 + Math.floor(rnd() * 3),
          dedupeKey: `i${iter}-${i}`,
        });
      }
      const naive = mergeSortedDedupeRowsNaive(rows, incoming);
      const opt = mergeSortedDedupeRows(rows, incoming);
      expect(opt.map((x) => x.dedupeKey).join(",")).toBe(naive.map((x) => x.dedupeKey).join(","));
    }
  });
});

describe("mergeNewestFirstDedupeIncremental", () => {
  it("merges out-of-order WS batch into sorted prev (newest first)", () => {
    const prev: R[] = [
      { timeMs: 300, nodeId: 1, dedupeKey: "p1" },
      { timeMs: 100, nodeId: 1, dedupeKey: "p2" },
    ];
    const incoming: R[] = [
      { timeMs: 250, nodeId: 2, dedupeKey: "w1" },
      { timeMs: 400, nodeId: 1, dedupeKey: "w2" },
      { timeMs: 260, nodeId: 2, dedupeKey: "w3" },
    ];
    const m = mergeNewestFirstDedupeIncremental(prev, incoming);
    expect(m.map((x) => x.dedupeKey).join(",")).toBe("w2,p1,w3,w1,p2");
  });

  it("dedupes against prev and within incoming", () => {
    const prev: R[] = [{ timeMs: 100, nodeId: 1, dedupeKey: "a" }];
    const incoming: R[] = [
      { timeMs: 200, nodeId: 1, dedupeKey: "a" },
      { timeMs: 200, nodeId: 1, dedupeKey: "b" },
      { timeMs: 200, nodeId: 1, dedupeKey: "b" },
    ];
    const m = mergeNewestFirstDedupeIncremental(prev, incoming);
    expect(m.map((x) => x.dedupeKey).join(",")).toBe("b,a");
  });

  it("orders delayed lower timeMs after newer prev rows (skew / backlog)", () => {
    const prev: R[] = [
      { timeMs: 500, nodeId: 1, dedupeKey: "p1" },
      { timeMs: 400, nodeId: 1, dedupeKey: "p2" },
    ];
    const incoming: R[] = [{ timeMs: 50, nodeId: 1, dedupeKey: "lateOld" }];
    const m = mergeNewestFirstDedupeIncremental(prev, incoming);
    expect(m.map((x) => x.dedupeKey).join(",")).toBe("p1,p2,lateOld");
  });

  it("tie-breaks equal timeMs like full sort", () => {
    const prev: R[] = [{ timeMs: 100, nodeId: 2, dedupeKey: "p" }];
    const incoming: R[] = [
      { timeMs: 100, nodeId: 1, dedupeKey: "n1" },
      { timeMs: 100, nodeId: 3, dedupeKey: "n2" },
    ];
    const m = mergeNewestFirstDedupeIncremental(prev, incoming);
    expect(m.map((x) => x.dedupeKey).join(",")).toBe("n2,p,n1");
  });

  it("respects MAX_MERGED_LOG_LINES", () => {
    const prev: R[] = [];
    const incoming: R[] = [];
    for (let i = 0; i < MAX_MERGED_LOG_LINES + 5; i++) {
      incoming.push({ timeMs: 1_000_000 + i, nodeId: 1, dedupeKey: `k${i}` });
    }
    const m = mergeNewestFirstDedupeIncremental(prev, incoming);
    expect(m.length).toBe(MAX_MERGED_LOG_LINES);
  });

  it("within time skew orders by receivedAt (newer delivery first)", () => {
    const prev: R[] = [{ timeMs: 1000, nodeId: 1, dedupeKey: "p", receivedAt: 10 }];
    const incoming: R[] = [
      { timeMs: 1005, nodeId: 1, dedupeKey: "b", receivedAt: 50 },
      { timeMs: 1000, nodeId: 1, dedupeKey: "a", receivedAt: 100 },
    ];
    const m = mergeNewestFirstDedupeIncremental(prev, incoming);
    expect(m.map((x) => x.dedupeKey).join(",")).toBe("a,b,p");
  });

  it("matches naive full-sort merge for random WS batches (skew + receivedAt)", () => {
    let rng = 77_777;
    const rnd = () => {
      rng = (rng * 1103515245 + 12345) >>> 0;
      return rng / 0xffff_ffff;
    };
    for (let iter = 0; iter < 80; iter++) {
      const plen = Math.floor(rnd() * 12);
      const prev: R[] = [];
      for (let i = 0; i < plen; i++) {
        prev.push({
          timeMs: Math.floor(rnd() * 1e9),
          nodeId: 1 + Math.floor(rnd() * 3),
          dedupeKey: `p${iter}-${i}`,
          receivedAt: Math.floor(rnd() * 1e6),
        });
      }
      prev.sort(compareLogRowsNewestFirstWithSkew);
      const incLen = Math.floor(rnd() * 8);
      const incoming: R[] = [];
      for (let i = 0; i < incLen; i++) {
        incoming.push({
          timeMs: Math.floor(rnd() * 1e9),
          nodeId: 1 + Math.floor(rnd() * 3),
          dedupeKey: `w${iter}-${i}`,
          receivedAt: Math.floor(rnd() * 1e6),
        });
      }
      const naive = mergeNewestFirstDedupeNaive(prev, incoming);
      const opt = mergeNewestFirstDedupeIncremental(prev, incoming);
      expect(opt.map((x) => x.dedupeKey).join(",")).toBe(naive.map((x) => x.dedupeKey).join(","));
    }
  });
});

describe("recomputePausedDeep", () => {
  it("marks far-behind node paused", () => {
    const T = 1_700_000_000_000;
    const rows = [
      { nodeId: 1, timeMs: T },
      { nodeId: 1, timeMs: T + 1000 },
      { nodeId: 2, timeMs: T - 3 * NODE_DEEP_PAUSE_GAP_MS },
    ];
    const p = recomputePausedDeep(rows);
    expect(p[1]).toBe(false);
    expect(p[2]).toBe(true);
  });
});
