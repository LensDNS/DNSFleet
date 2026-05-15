/**
 * AdGuard Home–style query log display helpers (defensive parsing).
 * RCODE (`status`) must never be merged into `answerSummary` string logic.
 *
 * Result visual priority (product): blocked > timeout > servfail > rewrite >
 * cache_hit > allowed > neutral. Slow-query accent may layer on top (see `isSlowQuery`).
 *
 * **Row colors (`inferResultKind`)** use AdGH fields `reason`, `status`, `cached`, etc.
 * Common `reason` enum strings from AdGuard Home (`internal/filtering/reason.go` → JSON
 * names such as `FilteredBlackList`, `NotFilteredWhiteList`) are mapped explicitly; unknown
 * values fall back to regex heuristics, then `neutral`.
 *
 * **Slow query (`isSlowQuery`)** uses `entry.elapsedMs` as reported by AdGuard Home
 * (resolver-side processing), not browser-to-control-plane RTT. Default threshold 100 ms
 * via `NEXT_PUBLIC_DNSFLEET_SLOW_QUERY_MS`. High upstream latency can surface many
 * slow-query badges—raise the threshold or fix DNS rather than treating it as network RTT.
 */

import type { AppLocale } from "@/lib/i18n/resolve-message";
import type { LocaleKey } from "@/lib/i18n/locales/en";
import { intlLocaleTag, resolveMessage } from "@/lib/i18n/resolve-message";

export type ResultKind =
  | "blocked"
  | "servfail"
  | "timeout"
  | "rewrite"
  | "cache_hit"
  | "allowed"
  | "neutral";

/** Alias of {@link ResultKind} for older call sites. */
export type RowTone = ResultKind;

export interface NormalizedQueryLogEntry {
  questionName: string;
  questionType: string;
  /** Primary 「请求」 cell: name + QTYPE (and optional hints). */
  requestLine: string;
  /** RCODE / processing status string from entry (separate from answer summary). */
  status: string;
  /** Short RR summary; never contains RCODE text by construction. */
  answerSummary: string;
  /** Legacy combined client cell; prefer {@link clientPrimary} / {@link clientSecondary}. */
  client: string;
  /** Client ID / hostname / display name when present (primary in table). */
  clientPrimary: string;
  /** IP or secondary client string (muted row below primary). */
  clientSecondary: string;
  upstream: string;
  reason: string;
  elapsedMsLabel: string;
  /** Optional extra hint for response summary cell (cache hits use Badge only, not this field). */
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

/** Raw elapsed in ms for thresholds; null when missing / unparsable. */
export function parseElapsedMs(entry: Record<string, unknown>): number | null {
  const ms = entry.elapsedMs;
  if (ms === null || ms === undefined) return null;
  if (typeof ms === "number" && Number.isFinite(ms)) return ms;
  const raw = String(ms).trim();
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  if (Number.isFinite(n)) return n;
  return null;
}

/**
 * Optional build-time override: `NEXT_PUBLIC_DNSFLEET_SLOW_QUERY_MS` (positive number).
 * Default 100 ms.
 */
export function slowQueryThresholdMs(): number {
  if (typeof process === "undefined") return 100;
  const raw = process.env.NEXT_PUBLIC_DNSFLEET_SLOW_QUERY_MS;
  if (raw === undefined || raw === "") return 100;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

export function isSlowQuery(entry: Record<string, unknown>, thresholdMs?: number): boolean {
  const t = thresholdMs ?? slowQueryThresholdMs();
  const n = parseElapsedMs(entry);
  return n !== null && n > t;
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

/**
 * CID / display name first, IP (`client`) second when both differ.
 * Defensive over `client_info` shapes from AdGuard Home.
 */
export function extractClientPresentation(entry: Record<string, unknown>): {
  primary: string;
  secondary: string;
} {
  const clientRaw = asString(entry.client).trim();
  const ci = entry.client_info;
  let primary = "";
  if (ci && typeof ci === "object" && !Array.isArray(ci)) {
    const o = ci as Record<string, unknown>;
    primary =
      asString(o.name).trim() ||
      asString(o.display_name).trim() ||
      asString(o.hostname).trim() ||
      asString(o.cid).trim();
  }
  if (!primary) {
    primary = asString(entry.cid).trim();
  }
  if (primary) {
    if (!clientRaw || primary === clientRaw) return { primary, secondary: "" };
    return { primary, secondary: clientRaw };
  }
  return { primary: clientRaw, secondary: "" };
}

function isTimeoutBlob(blob: string): boolean {
  return /\b(timeout|timed out|time out|i\/o timeout|deadline exceeded|context deadline|upstream.*timeout|超时)\b/i.test(
    blob,
  );
}

function isServfailBlob(blob: string, statusUpper: string): boolean {
  if (/\bSERVFAIL\b/.test(statusUpper)) return true;
  return /\b(servfail|server fail|upstream error)\b/i.test(blob);
}

function isCacheHitEntry(entry: Record<string, unknown>, blob: string): boolean {
  if (entry.cached === true) return true;
  return /\b(from cache|cache hit|cached response)\b/i.test(blob);
}

/**
 * Exact `reason` strings emitted by AdGuard Home query logs (see upstream
 * `internal/filtering/reason.go` → `reasonNames`). Keys must match JSON casing.
 * Values are intermediate tags; {@link inferResultKind} still applies the global priority chain.
 */
const ADGUARD_REASON_EXACT: Record<string, "blocked" | "allowed" | "rewrite" | "neutral"> = {
  // Filtered* → blocked (API uses e.g. FilteredBlackList for FilteredBlockList)
  FilteredBlackList: "blocked",
  FilteredSafeBrowsing: "blocked",
  FilteredParental: "blocked",
  FilteredInvalid: "blocked",
  FilteredSafeSearch: "blocked",
  FilteredBlockedService: "blocked",
  // Allow-list pass (API string is NotFilteredWhiteList)
  NotFilteredWhiteList: "allowed",
  // Default “processed”, not rule-allow semantics
  NotFilteredNotFound: "neutral",
  NotFilteredError: "neutral",
  // Rewrite family (API uses Rewrite / RewriteEtcHosts / RewriteRule)
  Rewrite: "rewrite",
  RewriteEtcHosts: "rewrite",
  RewriteRule: "rewrite",
};

function explicitAdGuardReasonTag(
  reason: string,
): "blocked" | "allowed" | "rewrite" | "neutral" | undefined {
  const t = reason.trim();
  if (!t) return undefined;
  return ADGUARD_REASON_EXACT[t];
}

/** Forward-compat: new `FilteredFoo` enum values from AdGH without updating the table. */
function isAdGuardFilteredEnum(reason: string): boolean {
  return /^Filtered[A-Za-z0-9]+$/.test(reason.trim());
}

function isBlockedReasonOrHeuristic(reason: string, blob: string): boolean {
  const tag = explicitAdGuardReasonTag(reason);
  if (tag === "blocked") return true;
  if (isAdGuardFilteredEnum(reason)) return true;
  return (
    /\b(blocked|filtered|denied|not allowed|dnsfilter|adblock)\b|拦截|拒绝|过滤/.test(blob)
  );
}

/**
 * Infers row result kind using the product priority chain.
 */
export function inferResultKind(entry: Record<string, unknown>): ResultKind {
  const reason = asString(entry.reason).trim();
  const status = asString(entry.status);
  const blob = `${reason} ${status}`.toLowerCase();
  const statusUpper = status.toUpperCase();

  if (isBlockedReasonOrHeuristic(reason, blob)) return "blocked";
  if (isTimeoutBlob(blob)) return "timeout";
  if (isServfailBlob(blob, statusUpper)) return "servfail";

  const ex = explicitAdGuardReasonTag(reason);
  if (ex === "rewrite") return "rewrite";
  if (/\b(rewrite|rewritten|dns rewrite)\b|重写/.test(blob)) return "rewrite";

  if (isCacheHitEntry(entry, blob)) return "cache_hit";

  if (ex === "allowed") return "allowed";
  if (/\b(allowlist|whitelist|allowed by rule|custom allow)\b|放行|白名单/.test(blob)) {
    return "allowed";
  }

  if (ex === "neutral") return "neutral";
  return "neutral";
}

/** @see {@link inferResultKind} */
export function inferRowTone(entry: Record<string, unknown>): RowTone {
  return inferResultKind(entry);
}

const RESULT_KIND_ARIA: Record<ResultKind, LocaleKey> = {
  blocked: "liveLogs.resultKind.blocked.aria",
  servfail: "liveLogs.resultKind.servfail.aria",
  timeout: "liveLogs.resultKind.timeout.aria",
  rewrite: "liveLogs.resultKind.rewrite.aria",
  cache_hit: "liveLogs.resultKind.cache_hit.aria",
  allowed: "liveLogs.resultKind.allowed.aria",
  neutral: "liveLogs.resultKind.neutral.aria",
};

const RESULT_KIND_SHORT: Record<ResultKind, LocaleKey> = {
  blocked: "liveLogs.resultKind.blocked.short",
  servfail: "liveLogs.resultKind.servfail.short",
  timeout: "liveLogs.resultKind.timeout.short",
  rewrite: "liveLogs.resultKind.rewrite.short",
  cache_hit: "liveLogs.resultKind.cache_hit.short",
  allowed: "liveLogs.resultKind.allowed.short",
  neutral: "liveLogs.resultKind.neutral.short",
};

export function resultKindAriaLabel(kind: ResultKind, locale: AppLocale): string {
  return resolveMessage(RESULT_KIND_ARIA[kind], locale);
}

export function resultKindShortLabel(kind: ResultKind, locale: AppLocale): string {
  return resolveMessage(RESULT_KIND_SHORT[kind], locale);
}

/** Row background (low saturation; works in light + dark). */
export function resultKindRowClass(kind: ResultKind): string {
  switch (kind) {
    case "blocked":
      return "bg-rose-500/[0.07] hover:bg-rose-500/[0.11] dark:bg-rose-400/[0.08] dark:hover:bg-rose-400/[0.11]";
    case "servfail":
      return "bg-orange-500/[0.08] hover:bg-orange-500/[0.12] dark:bg-orange-400/[0.09] dark:hover:bg-orange-400/[0.12]";
    case "timeout":
      return "bg-amber-400/[0.1] hover:bg-amber-400/[0.14] dark:bg-amber-300/[0.08] dark:hover:bg-amber-300/[0.11]";
    case "rewrite":
      return "bg-sky-500/[0.07] hover:bg-sky-500/[0.11] dark:bg-sky-400/[0.08] dark:hover:bg-sky-400/[0.11]";
    case "cache_hit":
      return "bg-emerald-500/[0.07] hover:bg-emerald-500/[0.11] dark:bg-emerald-400/[0.08] dark:hover:bg-emerald-400/[0.11]";
    case "allowed":
      return "bg-slate-500/[0.08] hover:bg-slate-500/[0.12] dark:bg-slate-400/[0.09] dark:hover:bg-slate-400/[0.12]";
    default:
      return "";
  }
}

/** Left accent (non–color-only cue alongside labels). */
export function resultKindBorderClass(kind: ResultKind): string {
  switch (kind) {
    case "blocked":
      return "border-l-2 border-l-rose-400/55 dark:border-l-rose-300/45";
    case "servfail":
      return "border-l-2 border-l-orange-400/55 dark:border-l-orange-300/45";
    case "timeout":
      return "border-l-2 border-l-amber-500/50 dark:border-l-amber-300/45";
    case "rewrite":
      return "border-l-2 border-l-sky-400/55 dark:border-l-sky-300/45";
    case "cache_hit":
      return "border-l-2 border-l-emerald-400/50 dark:border-l-emerald-300/45";
    case "allowed":
      return "border-l-2 border-l-slate-400/50 dark:border-l-slate-400/40";
    default:
      return "border-l-2 border-l-transparent";
  }
}

/** Subtle warm inset when elapsed exceeds slow threshold (respects reduced motion via static ring). */
export function slowQueryRowAccentClass(slow: boolean): string {
  if (!slow) return "";
  return "shadow-[inset_0_0_0_1px_oklch(0.78_0.12_75_/_0.28)] dark:shadow-[inset_0_0_0_1px_oklch(0.72_0.12_75_/_0.32)]";
}

/** @see {@link resultKindRowClass} */
export function rowToneRowClass(kind: RowTone): string {
  return resultKindRowClass(kind);
}

/** @see {@link resultKindBorderClass} */
export function rowToneBorderClass(kind: RowTone): string {
  return resultKindBorderClass(kind);
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
  const elapsedMsLabel = formatElapsedMsLabel(entry.elapsedMs);

  const { primary, secondary } = extractClientPresentation(entry);
  const clientPrimary = dash(primary);
  const clientSecondary = secondary.trim();

  const responseExtra = "";

  return {
    questionName: dash(name),
    questionType: dash(type),
    requestLine,
    status,
    answerSummary,
    client: clientPrimary,
    clientPrimary,
    clientSecondary,
    upstream,
    reason,
    elapsedMsLabel,
    responseExtra,
  };
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
export const DISPLAY_TIME_OPTS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  year: "numeric",
  month: "numeric",
  day: "numeric",
};

export function formatDisplayTime(
  entryTime: unknown,
  receivedAtMs: number,
  locale: AppLocale,
): string {
  const ms = entryTimeToMs(entryTime, receivedAtMs);
  return new Date(ms).toLocaleString(intlLocaleTag(locale), DISPLAY_TIME_OPTS);
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
export function entryDetailSections(
  entry: Record<string, unknown>,
  locale: AppLocale,
): EntryDetailSection[] {
  const out: EntryDetailSection[] = [];
  const dt = (key: LocaleKey) => resolveMessage(key, locale);

  const q = entry.question;
  if (q !== undefined && q !== null) {
    out.push({
      title: dt("liveLogs.detail.question"),
      body: typeof q === "string" ? q : jsonPretty(q),
    });
  }

  const a = entry.answer;
  if (a !== undefined && a !== null) {
    if (typeof a === "string") {
      out.push({ title: dt("liveLogs.detail.answer"), body: a });
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
      out.push({
        title: dt("liveLogs.detail.answerRR"),
        body: lines.length ? lines.join("\n") : "—",
      });
    } else {
      out.push({ title: dt("liveLogs.detail.answer"), body: jsonPretty(a) });
    }
  }

  const extraBits: string[] = [];
  if (entry.cached === true) extraBits.push("cached: true");
  if (entry.answer_dnssec !== undefined)
    extraBits.push(`answer_dnssec: ${jsonPretty(entry.answer_dnssec)}`);
  if (extraBits.length) {
    out.push({
      title: dt("liveLogs.detail.answerMeta"),
      body: extraBits.join("\n"),
    });
  }

  const rules = entry.rules ?? entry.rule;
  if (rules !== undefined && rules !== null && rules !== "") {
    out.push({
      title: dt("liveLogs.detail.rules"),
      body: Array.isArray(rules) ? jsonPretty(rules) : String(rules),
    });
  }

  const ci = entry.client_info;
  if (ci !== undefined && ci !== null && typeof ci === "object") {
    out.push({
      title: dt("liveLogs.detail.clientInfo"),
      body: jsonPretty(ci),
    });
  }

  const cp = entry.client_proto;
  if (cp !== undefined && cp !== null && String(cp).trim() !== "") {
    out.push({
      title: dt("liveLogs.detail.clientProto"),
      body: String(cp),
    });
  }

  return out;
}

/** One-line summary for primary 「响应」 cell: status + elapsed + optional extra (not full RR). */
export function formatResponseSummaryLine(n: NormalizedQueryLogEntry): string {
  const bits = [n.status, n.elapsedMsLabel];
  if (n.responseExtra) bits.push(n.responseExtra);
  return bits.join(" · ");
}
