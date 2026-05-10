import { describe, expect, it } from "vitest";

import {
  entryDetailSections,
  entryTimeToMs,
  formatDisplayTime,
  formatElapsedMsLabel,
  inferRowTone,
  normalizeEntry,
} from "./query-log-display";

describe("normalizeEntry", () => {
  it("keeps status separate from answer summary", () => {
    const entry: Record<string, unknown> = {
      status: "NOERROR",
      answer: [{ type: "A", value: "1.1.1.1" }],
      question: { name: "example.com", type: "A" },
    };
    const n = normalizeEntry(entry);
    expect(n.status).toBe("NOERROR");
    expect(n.answerSummary).toContain("A:");
    expect(n.answerSummary.toLowerCase()).not.toContain("noerror");
  });

  it("formats string elapsedMs", () => {
    const n = normalizeEntry({ elapsedMs: "23", question: { name: "x", type: "A" } });
    expect(n.elapsedMsLabel).toBe("23 ms");
  });
});

describe("formatElapsedMsLabel", () => {
  it("returns dash for empty", () => {
    expect(formatElapsedMsLabel(undefined)).toBe("—");
  });
});

describe("entryTimeToMs", () => {
  it("parses unix seconds", () => {
    expect(entryTimeToMs(1_700_000_000, 0)).toBe(1_700_000_000_000);
  });
  it("parses ISO string", () => {
    const ms = entryTimeToMs("2024-06-01T12:00:00.000Z", 0);
    expect(ms).toBe(new Date("2024-06-01T12:00:00.000Z").getTime());
  });
});

describe("entryDetailSections", () => {
  it("lists answer RRs without truncation", () => {
    const secs = entryDetailSections({
      question: { name: "x.example.com", type: "A" },
      answer: [
        { type: "A", value: "10.0.0.1", ttl: 60 },
        { type: "AAAA", value: "::1" },
      ],
    });
    const ans = secs.find((s) => s.title === "answer (RR)");
    expect(ans?.body).toMatch(/A\s+10\.0\.0\.1/);
    expect(ans?.body).toContain("AAAA");
  });
});

describe("formatDisplayTime", () => {
  it("falls back to receivedAt when entry time string is invalid", () => {
    const t = 1_700_000_000_000;
    const s = formatDisplayTime("not-a-date", t);
    expect(s).toBe(
      new Date(t).toLocaleString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }),
    );
  });
});

describe("inferRowTone", () => {
  it("blocked on filter-like reason", () => {
    expect(inferRowTone({ reason: "Filtered", status: "NOERROR" })).toBe("blocked");
  });
  it("rewrite", () => {
    expect(inferRowTone({ reason: "DNS rewrite", status: "NOERROR" })).toBe("rewrite");
  });
  it("rewrite single word", () => {
    expect(inferRowTone({ reason: "Rewrite", status: "NOERROR" })).toBe("rewrite");
  });
  it("allowed / whitelist", () => {
    expect(inferRowTone({ reason: "Allowed by whitelist", status: "NOERROR" })).toBe("allowed");
  });
  it("normal NOERROR neutral", () => {
    expect(inferRowTone({ status: "NOERROR", reason: "" })).toBe("neutral");
  });
});
