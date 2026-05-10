/**
 * AdGuard Home–style query log display helpers (defensive parsing).
 * RCODE (`status`) must never be merged into `answerSummary` string logic.
 */

export type RowTone = "blocked" | "rewrite" | "allowed" | "neutral";

export interface NormalizedQueryLogEntry {
  questionName: string;
  questionType: string;
  /** Primary 「请求」 cell: name + QTYPE (and optional hints). */
  requestLine: string;
  /** RCODE / processing status string from entry (separate from answer summary). */
  status: string;
  /** Short RR summary; never contains RCODE text by construction. */
  answerSummary: string;
  client: string;
  upstream: string;
  reason: string;
  elapsedMsLabel: string;
  /** Extra hint for response summary cell (e.g. cached). */
  responseExtra: string;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function dash(s: string): string {
  return s.trim() ? s : "—";
}

/** `elapsedMs` may be number or string (AdGH examples). */
export function formatElapsedMsLabel(ms: unknown): string {
  if (ms === null || ms === undefined) return "—";
  if (typeof ms === "number" && Number.isFinite(ms)) return `${Math.round(ms)} ms`;
  const raw = String(ms).trim();
  if (!raw) return "—";
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  if (Number.isFinite(n)) return `${Math.round(n)} ms`;
  return "—";
}

function parseQuestion(entry: Record<string, unknown>): { name: string; type: string } {
  const q = entry.question;
  if (typeof q === "string") {
    return { name: q.trim(), type: "" };
  }
  if (q && typeof q === "object") {
    const o = q as Record<string, unknown>;
    return { name: asString(o.name).trim(), type: asString(o.type).trim() };
  }
  return { name: "", type: "" };
}

function summarizeAnswer(entry: Record<string, unknown>): string {
  const a = entry.answer;
  if (a === undefined || a === null) return "—";
  if (typeof a === "string") {
    const t = a.trim();
    if (!t) return "—";
    return t.length > 96 ? `${t.slice(0, 93)}…` : t;
  }
  if (!Array.isArray(a) || a.length === 0) return "—";

  const first = a[0];
  let head = "";
  if (typeof first === "object" && first !== null) {
    const o = first as Record<string, unknown>;
    const typ = asString(o.type);
    const val = asString(o.value ?? o.ip ?? o.name ?? o.host);
    head = typ && val ? `${typ}: ${val}` : JSON.stringify(first);
  } else {
    head = String(first);
  }
  head = head.length > 80 ? `${head.slice(0, 77)}…` : head;
  if (a.length > 1) return `${head} (+${a.length - 1})`;
  return head;
}

export function normalizeEntry(entry: Record<string, unknown>): NormalizedQueryLogEntry {
  const { name, type } = parseQuestion(entry);
  const parts: string[] = [];
  if (name) parts.push(name);
  if (type) parts.push(type);
  const requestLine = dash(parts.join(" · "));

  const status = dash(asString(entry.status));
  const answerSummary = summarizeAnswer(entry);
  const reason = dash(asString(entry.reason));
  const upstream = dash(asString(entry.upstream));
  const client = dash(asString(entry.client));
  const elapsedMsLabel = formatElapsedMsLabel(entry.elapsedMs);

  let responseExtra = "";
  if (entry.cached === true) responseExtra = "cached";

  return {
    questionName: dash(name),
    questionType: dash(type),
    requestLine,
    status,
    answerSummary,
    client,
    upstream,
    reason,
    elapsedMsLabel,
    responseExtra,
  };
}

/**
 * Heuristic row semantics for background tint.
 * `neutral` = normal resolution / unknown (no row tint).
 * `allowed` = rule allow / whitelist-style hints.
 */
export function inferRowTone(entry: Record<string, unknown>): RowTone {
  const reason = asString(entry.reason).toLowerCase();
  const status = asString(entry.status).toLowerCase();
  const blob = `${reason} ${status}`;

  if (/\b(rewrite|rewritten|dns rewrite)\b|重写/.test(blob)) return "rewrite";
  if (/\b(allowlist|whitelist|allowed by rule|custom allow)\b|放行|白名单/.test(blob)) return "allowed";
  if (
    /\b(blocked|filtered|denied|not allowed|dnsfilter|adblock)\b|拦截|拒绝|过滤/.test(blob)
  ) {
    return "blocked";
  }
  return "neutral";
}

/** Tailwind row classes; `neutral` returns empty (no tint). */
export function rowToneRowClass(tone: RowTone): string {
  switch (tone) {
    case "blocked":
      return "bg-rose-950/30 hover:bg-rose-950/40";
    case "rewrite":
      return "bg-sky-950/30 hover:bg-sky-950/40";
    case "allowed":
      return "bg-emerald-950/30 hover:bg-emerald-950/40";
    default:
      return "";
  }
}

/** Optional left border accent (non–color-only cue). */
export function rowToneBorderClass(tone: RowTone): string {
  switch (tone) {
    case "blocked":
      return "border-l-2 border-l-rose-400/70";
    case "rewrite":
      return "border-l-2 border-l-sky-400/70";
    case "allowed":
      return "border-l-2 border-l-emerald-400/70";
    default:
      return "border-l-2 border-l-transparent";
  }
}

/**
 * Parse `entry.time` (ISO or unix seconds/ms) to epoch ms; fall back to `fallbackMs` when missing/invalid.
 * Aligns with {@link formatDisplayTime} parsing rules.
 */
export function entryTimeToMs(entryTime: unknown, fallbackMs: number): number {
  if (entryTime !== null && entryTime !== undefined && entryTime !== "") {
    if (typeof entryTime === "number" && Number.isFinite(entryTime)) {
      const ms = entryTime < 1e12 ? entryTime * 1000 : entryTime;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return ms;
    }
    if (typeof entryTime === "string") {
      const d = new Date(entryTime.trim());
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
  }
  return fallbackMs;
}

/**
 * Prefer `entry.time` (ISO or unix); else format `receivedAtMs` (local receipt time).
 */
export function formatDisplayTime(entryTime: unknown, receivedAtMs: number): string {
  const ms = entryTimeToMs(entryTime, receivedAtMs);
  return new Date(ms).toLocaleString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

/** Human-readable sections for detail panel (full response, not table summary). */
export type EntryDetailSection = { title: string; body: string };

function jsonPretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Structured blocks for one query-log entry (AdGH-shaped); no truncation. */
export function entryDetailSections(entry: Record<string, unknown>): EntryDetailSection[] {
  const out: EntryDetailSection[] = [];

  const q = entry.question;
  if (q !== undefined && q !== null) {
    out.push({ title: "question", body: typeof q === "string" ? q : jsonPretty(q) });
  }

  const a = entry.answer;
  if (a !== undefined && a !== null) {
    if (typeof a === "string") {
      out.push({ title: "answer", body: a });
    } else if (Array.isArray(a)) {
      const lines: string[] = [];
      for (let i = 0; i < a.length; i++) {
        const rr = a[i];
        if (rr !== null && typeof rr === "object" && !Array.isArray(rr)) {
          const o = rr as Record<string, unknown>;
          const typ = asString(o.type);
          const val = asString(o.value ?? o.ip ?? o.name ?? o.host);
          const ttl = o.ttl !== undefined ? ` ttl=${jsonPretty(o.ttl)}` : "";
          lines.push(`${i + 1}. ${typ || "?"} ${val}${ttl}`.trim());
        } else {
          lines.push(`${i + 1}. ${jsonPretty(rr)}`);
        }
      }
      out.push({ title: "answer (RR)", body: lines.length ? lines.join("\n") : "—" });
    } else {
      out.push({ title: "answer", body: jsonPretty(a) });
    }
  }

  const extraBits: string[] = [];
  if (entry.cached === true) extraBits.push("cached: true");
  if (entry.answer_dnssec !== undefined) extraBits.push(`answer_dnssec: ${jsonPretty(entry.answer_dnssec)}`);
  if (extraBits.length) {
    out.push({ title: "answer 元数据", body: extraBits.join("\n") });
  }

  const rules = entry.rules ?? entry.rule;
  if (rules !== undefined && rules !== null && rules !== "") {
    out.push({ title: "rules", body: Array.isArray(rules) ? jsonPretty(rules) : String(rules) });
  }

  const ci = entry.client_info;
  if (ci !== undefined && ci !== null && typeof ci === "object") {
    out.push({ title: "client_info", body: jsonPretty(ci) });
  }

  const cp = entry.client_proto;
  if (cp !== undefined && cp !== null && String(cp).trim() !== "") {
    out.push({ title: "client_proto", body: String(cp) });
  }

  return out;
}

/** One-line summary for primary 「响应」 cell: status + elapsed + optional extra (not full RR). */
export function formatResponseSummaryLine(n: NormalizedQueryLogEntry): string {
  const bits = [n.status, n.elapsedMsLabel];
  if (n.responseExtra) bits.push(n.responseExtra);
  return bits.join(" · ");
}
