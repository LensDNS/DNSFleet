import { describe, expect, it } from "vitest";

import {
  entryDetailSections,
  entryTimeToMs,
  extractClientPresentation,
  formatDisplayTime,
  formatElapsedMsLabel,
  inferResultKind,
  inferRowTone,
  isSlowQuery,
  normalizeEntry,
  parseElapsedMs,
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

  it("CID/name primary and IP secondary when client_info present", () => {
    const n = normalizeEntry({
      question: { name: "q", type: "A" },
      client: "192.168.1.10",
      client_info: { name: "living-room-tv" },
    });
    expect(n.clientPrimary).toBe("living-room-tv");
    expect(n.clientSecondary).toBe("192.168.1.10");
  });

  it("IP only when no client_info name", () => {
    const n = normalizeEntry({
      question: { name: "q", type: "A" },
      client: "10.0.0.2",
    });
    expect(n.clientPrimary).toBe("10.0.0.2");
    expect(n.clientSecondary).toBe("");
  });
});

describe("formatElapsedMsLabel", () => {
  it("returns dash for empty", () => {
    expect(formatElapsedMsLabel(undefined)).toBe("—");
  });
});

describe("parseElapsedMs / isSlowQuery", () => {
  it("detects slow when above default threshold", () => {
    expect(isSlowQuery({ elapsedMs: 150 })).toBe(true);
    expect(isSlowQuery({ elapsedMs: 50 })).toBe(false);
  });

  it("parses string elapsed", () => {
    expect(parseElapsedMs({ elapsedMs: "120" })).toBe(120);
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

describe("extractClientPresentation", () => {
  it("prefers client_info.name over IP", () => {
    expect(
      extractClientPresentation({
        client: "192.168.0.1",
        client_info: { name: "kid-laptop" },
      }),
    ).toEqual({ primary: "kid-laptop", secondary: "192.168.0.1" });
  });
});

describe("inferResultKind", () => {
  it("blocked on filter-like reason", () => {
    expect(inferResultKind({ reason: "Filtered", status: "NOERROR" })).toBe("blocked");
  });
  it("blocked wins over cache_hit", () => {
    expect(inferResultKind({ reason: "Filtered", status: "NOERROR", cached: true })).toBe("blocked");
  });
  it("rewrite", () => {
    expect(inferResultKind({ reason: "DNS rewrite", status: "NOERROR" })).toBe("rewrite");
  });
  it("rewrite single word", () => {
    expect(inferResultKind({ reason: "Rewrite", status: "NOERROR" })).toBe("rewrite");
  });
  it("allowed / whitelist", () => {
    expect(inferResultKind({ reason: "Allowed by whitelist", status: "NOERROR" })).toBe("allowed");
  });
  it("cache_hit from cached flag", () => {
    expect(inferResultKind({ status: "NOERROR", reason: "", cached: true })).toBe("cache_hit");
  });
  it("SERVFAIL", () => {
    expect(inferResultKind({ status: "SERVFAIL", reason: "" })).toBe("servfail");
  });
  it("timeout blob", () => {
    expect(inferResultKind({ status: "NOERROR", reason: "upstream timeout" })).toBe("timeout");
  });
  it("timeout before servfail when timeout explicit", () => {
    expect(inferResultKind({ status: "SERVFAIL", reason: "i/o timeout" })).toBe("timeout");
  });
  it("normal NOERROR neutral", () => {
    expect(inferResultKind({ status: "NOERROR", reason: "" })).toBe("neutral");
  });

  // AdGuard Home JSON `reason` is often a PascalCase enum with no spaces (reason.go → reasonNames).
  it("FilteredBlackList (no-space enum) is blocked", () => {
    expect(inferResultKind({ reason: "FilteredBlackList", status: "NOERROR" })).toBe("blocked");
  });
  it("FilteredBlackList still beats cache_hit", () => {
    expect(inferResultKind({ reason: "FilteredBlackList", status: "NOERROR", cached: true })).toBe(
      "blocked",
    );
  });
  it("NotFilteredWhiteList is allow-list (maps to allowed)", () => {
    expect(inferResultKind({ reason: "NotFilteredWhiteList", status: "NOERROR" })).toBe("allowed");
  });
  it("NotFilteredNotFound is neutral (not rule-allow)", () => {
    expect(inferResultKind({ reason: "NotFilteredNotFound", status: "NOERROR" })).toBe("neutral");
  });
  it("unknown FilteredFooEnum treated as blocked via Filtered* prefix", () => {
    expect(inferResultKind({ reason: "FilteredFutureKind", status: "NOERROR" })).toBe("blocked");
  });
  it("RewriteRule from AdGH enum", () => {
    expect(inferResultKind({ reason: "RewriteRule", status: "NOERROR" })).toBe("rewrite");
  });
  it("SERVFAIL still wins over NotFilteredNotFound neutral tag", () => {
    expect(inferResultKind({ reason: "NotFilteredNotFound", status: "SERVFAIL" })).toBe("servfail");
  });
});

describe("inferRowTone alias", () => {
  it("matches inferResultKind", () => {
    expect(inferRowTone({ status: "SERVFAIL" })).toBe("servfail");
  });
});
