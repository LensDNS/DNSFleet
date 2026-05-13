import { describe, expect, it } from "vitest";

import {
  MAX_MERGED_LOG_LINES,
  mergeNewestFirstDedupeIncremental,
  mergeSortedDedupeRows,
  NODE_DEEP_PAUSE_GAP_MS,
  recomputePausedDeep,
} from "./live-logs-merge";

type R = { timeMs: number; nodeId: number; dedupeKey: string };

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
