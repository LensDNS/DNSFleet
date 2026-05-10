import { describe, expect, it } from "vitest";

import {
  MAX_MERGED_LOG_LINES,
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
