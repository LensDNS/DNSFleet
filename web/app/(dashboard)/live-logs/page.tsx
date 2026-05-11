"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EllipsisVertical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isSkipAdminAuth } from "@/lib/auth-token";
import type { WsLogMessage } from "@/lib/dnsfleet-types";
import {
  entryDetailSections,
  entryTimeToMs,
  formatDisplayTime,
  formatResponseSummaryLine,
  inferResultKind,
  isSlowQuery,
  normalizeEntry,
  resultKindAriaLabel,
  resultKindBorderClass,
  resultKindRowClass,
  resultKindShortLabel,
  slowQueryRowAccentClass,
  type NormalizedQueryLogEntry,
  type ResultKind,
} from "@/lib/query-log-display";
import {
  logRowDedupeKeyHex,
  MAX_MERGED_LOG_LINES,
  mergeNewestFirstDedupeIncremental,
  mergeSortedDedupeRows,
  recomputePausedDeep,
} from "@/lib/live-logs-merge";
import { fetchNodeQueryLog, fetchNodes } from "@/lib/node-querylog";
import { buildLogsWebSocketUrl } from "@/lib/ws-logs-url";
import { useLocale } from "@/lib/i18n/locale-context";
import { interpolate } from "@/lib/i18n/resolve-message";
import { cn } from "@/lib/utils";

const MAX_SYSTEM = 100;

type LogRow = {
  kind: "log";
  key: string;
  dedupeKey: string;
  timeMs: number;
  receivedAt: number;
  nodeId: number;
  nodeName: string;
  entry: Record<string, unknown>;
  normalized: NormalizedQueryLogEntry;
  resultKind: ResultKind;
  slowQuery: boolean;
};

type SystemLine = {
  kind: "system";
  key: string;
  event: string;
  message: string;
};

type NodeTailState = {
  exhausted: boolean;
  /** Next request `older_than`; null when no further pages. */
  nextOlderThan: string | null;
};

function snapshotLogRow(row: LogRow): LogRow {
  return {
    ...row,
    entry: { ...row.entry },
    normalized: { ...row.normalized },
    resultKind: row.resultKind,
    slowQuery: row.slowQuery,
  };
}

async function buildLogRow(
  nodeId: number,
  nodeName: string,
  entry: Record<string, unknown>,
  receivedAt: number,
): Promise<LogRow> {
  const dedupeKey = await logRowDedupeKeyHex(nodeId, entry);
  return {
    kind: "log",
    key: dedupeKey,
    dedupeKey,
    timeMs: entryTimeToMs(entry.time, receivedAt),
    receivedAt,
    nodeId,
    nodeName,
    entry: { ...entry },
    normalized: normalizeEntry(entry),
    resultKind: inferResultKind(entry),
    slowQuery: isSlowQuery(entry),
  };
}

export default function LiveLogsPage() {
  const { t, locale } = useLocale();
  const [logRows, setLogRows] = useState<LogRow[]>([]);
  const [systemLines, setSystemLines] = useState<SystemLine[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [detail, setDetail] = useState<LogRow | null>(null);
  const [initialLoad, setInitialLoad] = useState<"loading" | "ready">("loading");
  const [nodeTails, setNodeTails] = useState<Record<number, NodeTailState>>({});
  const [pausedDeep, setPausedDeep] = useState<Record<number, boolean>>({});

  const logRowsRef = useRef(logRows);
  const nodeTailsRef = useRef(nodeTails);
  const pausedDeepRef = useRef(pausedDeep);
  const olderInFlight = useRef<Set<number>>(new Set());
  const loadOlderAbortRef = useRef<AbortController | null>(null);
  const fetchGen = useRef(0);
  const warnedNoUrl = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const autoFillBursts = useRef(0);
  const prevLogLen = useRef(0);
  const globalOlderBusy = useRef(false);
  const olderCooldownUntil = useRef(0);
  const wasAwayFromBottom = useRef(false);
  const pageSession = useRef(0);
  const pendingWsEntries = useRef<
    { nodeId: number; nodeName: string; entry: Record<string, unknown>; receivedAt: number }[]
  >([]);
  const wsFlushRaf = useRef<number | null>(null);

  useEffect(
    () => () => {
      loadOlderAbortRef.current?.abort();
      loadOlderAbortRef.current = null;
    },
    [],
  );

  useEffect(() => {
    logRowsRef.current = logRows;
  }, [logRows]);
  useEffect(() => {
    nodeTailsRef.current = nodeTails;
  }, [nodeTails]);
  useEffect(() => {
    pausedDeepRef.current = pausedDeep;
  }, [pausedDeep]);

  useEffect(() => {
    const session = pageSession;
    return () => {
      session.current += 1;
    };
  }, []);

  const detailJson = useMemo(() => {
    if (!detail) return "";
    try {
      return JSON.stringify(detail.entry, null, 2);
    } catch {
      return "";
    }
  }, [detail]);

  const detailSections = useMemo(
    () => (detail ? entryDetailSections(detail.entry, locale) : []),
    [detail, locale],
  );

  const loadOlderPage = useCallback(async () => {
    if (globalOlderBusy.current) return;
    const now = Date.now();
    if (now < olderCooldownUntil.current) return;

    const rows = logRowsRef.current;
    const tails = nodeTailsRef.current;
    const paused = pausedDeepRef.current;
    if (rows.length === 0) return;

    let pickIdx = rows.length - 1;
    let pickedNodeId: number | null = null;
    while (pickIdx >= 0) {
      const nid = rows[pickIdx].nodeId;
      const st = tails[nid];
      if (!st || st.exhausted || st.nextOlderThan === null) {
        pickIdx -= 1;
        continue;
      }
      if (paused[nid]) {
        pickIdx -= 1;
        continue;
      }
      if (olderInFlight.current.has(nid)) {
        pickIdx -= 1;
        continue;
      }
      pickedNodeId = nid;
      break;
    }
    if (pickedNodeId === null) return;

    const st = tails[pickedNodeId];
    if (st.nextOlderThan === null) return;

    const sessionAtStart = pageSession.current;
    globalOlderBusy.current = true;
    olderCooldownUntil.current = Date.now() + 300;

    olderInFlight.current.add(pickedNodeId);
    loadOlderAbortRef.current?.abort();
    const ac = new AbortController();
    loadOlderAbortRef.current = ac;
    try {
      const ql = await fetchNodeQueryLog(pickedNodeId, {
        older_than: st.nextOlderThan,
        limit: 20,
        response_status: "all",
        signal: ac.signal,
      });
      if (sessionAtStart !== pageSession.current) return;
      const receivedAt = Date.now();
      const incoming: LogRow[] = [];
      const nodeLabel = rows[pickIdx]?.nodeName ?? `node ${pickedNodeId}`;
      for (const entry of ql.data) {
        incoming.push(await buildLogRow(pickedNodeId, nodeLabel, entry, receivedAt));
      }
      const merged = mergeSortedDedupeRows(logRowsRef.current, incoming);
      logRowsRef.current = merged;
      setLogRows(merged);
      queueMicrotask(() => setPausedDeep(recomputePausedDeep(merged)));
      setNodeTails((prev) => ({
        ...prev,
        [pickedNodeId]: {
          exhausted: ql.oldest === "",
          nextOlderThan: ql.oldest === "" ? null : ql.oldest,
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "AbortError" && !msg.includes("aborted")) {
        toast.warning(`${t("liveLogs.toast.loadOlderFailed")} ${msg}`);
      }
    } finally {
      globalOlderBusy.current = false;
      if (loadOlderAbortRef.current === ac) {
        loadOlderAbortRef.current = null;
      }
      olderInFlight.current.delete(pickedNodeId);
    }
  }, [t]);

  const onTableScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist > 150) {
      wasAwayFromBottom.current = true;
      return;
    }
    if (dist <= 100 && wasAwayFromBottom.current) {
      wasAwayFromBottom.current = false;
      void loadOlderPage();
    }
  }, [loadOlderPage]);

  const historyStatusMessage = useMemo(() => {
    const ids = Object.keys(nodeTails)
      .map(Number)
      .filter((id) => Number.isFinite(id));
    if (ids.length === 0) return null;
    const exhausted = ids.filter((id) => {
      const s = nodeTails[id];
      return !s || s.exhausted || s.nextOlderThan === null;
    });
    if (exhausted.length === 0) return null;
    if (exhausted.length === ids.length) {
      return t("liveLogs.history.allExhausted");
    }
    return t("liveLogs.history.partialExhausted");
  }, [nodeTails, t]);

  useEffect(() => {
    if (logRows.length !== prevLogLen.current) {
      prevLogLen.current = logRows.length;
      autoFillBursts.current = 0;
    }
  }, [logRows.length]);

  /** When the table is shorter than the viewport, still chase `older_than` until scrollable or exhausted. */
  useEffect(() => {
    if (initialLoad !== "ready") return;
    const el = scrollRef.current;
    if (!el || logRows.length === 0) return;
    const short = el.scrollHeight <= el.clientHeight + 8;
    if (!short) return;
    if (autoFillBursts.current >= 9) return;
    autoFillBursts.current += 1;
    void loadOlderPage();
  }, [logRows.length, nodeTails, initialLoad, loadOlderPage]);

  useEffect(() => {
    if (initialLoad !== "ready") return;
    const root = scrollRef.current;
    const sent = sentinelRef.current;
    if (!root || !sent) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          if (ent.isIntersecting) void loadOlderPage();
        }
      },
      { root, rootMargin: "160px 0px", threshold: 0 },
    );
    io.observe(sent);
    return () => io.disconnect();
  }, [initialLoad, loadOlderPage, logRows.length]);

  useEffect(() => {
    const gen = ++fetchGen.current;
    const ac = new AbortController();

    void (async () => {
      setInitialLoad("loading");
      try {
        const nodes = await fetchNodes(ac.signal);
        if (gen !== fetchGen.current) return;
        const online = nodes.filter((n) => n.online);
        if (online.length === 0) {
          setNodeTails({});
          setPausedDeep({});
          setLogRows([]);
          setInitialLoad("ready");
          return;
        }

        const settled = await Promise.allSettled(
          online.map(async (n) => {
            const ql = await fetchNodeQueryLog(n.id, {
              limit: 20,
              response_status: "all",
              signal: ac.signal,
            });
            return { node: n, ql };
          }),
        );

        const incoming: LogRow[] = [];
        const tails: Record<number, NodeTailState> = {};
        const receivedAt = Date.now();

        for (const r of settled) {
          if (r.status === "rejected") {
            const err = r.reason;
            if (err instanceof Error && err.message.includes("aborted")) continue;
            const msg = err instanceof Error ? err.message : String(err);
            toast.warning(`${t("liveLogs.toast.firstPageWarn")} ${msg}`);
            continue;
          }
          const { node, ql } = r.value;
          tails[node.id] = {
            exhausted: ql.oldest === "",
            nextOlderThan: ql.oldest === "" ? null : ql.oldest,
          };
          for (const entry of ql.data) {
            incoming.push(await buildLogRow(node.id, node.name, entry, receivedAt));
          }
        }

        if (gen !== fetchGen.current) return;
        const merged = mergeSortedDedupeRows([], incoming);
        logRowsRef.current = merged;
        setLogRows(merged);
        setNodeTails(tails);
        setPausedDeep(recomputePausedDeep(merged));
      } catch (e) {
        if (gen !== fetchGen.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("aborted")) toast.error(`${t("liveLogs.toast.nodesLoadFailed")} ${msg}`);
      } finally {
        if (gen === fetchGen.current) setInitialLoad("ready");
      }
    })();

    return () => {
      ac.abort();
    };
  }, [t]);

  useEffect(() => {
    const built = buildLogsWebSocketUrl();
    if (!built) {
      if (!warnedNoUrl.current && !isSkipAdminAuth()) {
        warnedNoUrl.current = true;
        void Promise.resolve().then(() => {
          toast.error(t("liveLogs.toast.noWsToken"));
          setStatus("idle");
        });
      }
      return;
    }
    const safeWsUrl: string = built;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function scheduleReconnect() {
      if (cancelled) return;
      const maxMs = 30_000;
      const base = 1000;
      const delay = Math.min(maxMs, base * 2 ** Math.min(attempt, 5));
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function flushWsPending() {
      const batch = pendingWsEntries.current.splice(0);
      if (batch.length === 0) return;
      void (async () => {
        const built: LogRow[] = [];
        for (const item of batch) {
          try {
            built.push(
              await buildLogRow(item.nodeId, item.nodeName, item.entry, item.receivedAt),
            );
          } catch {
            // skip one malformed row
          }
        }
        if (cancelled || built.length === 0) return;
        const merged = mergeNewestFirstDedupeIncremental(logRowsRef.current, built);
        logRowsRef.current = merged;
        setLogRows(merged);
        queueMicrotask(() => setPausedDeep(recomputePausedDeep(merged)));
      })();
    }

    function scheduleWsFlush() {
      if (cancelled) return;
      if (wsFlushRaf.current != null) return;
      wsFlushRaf.current = requestAnimationFrame(() => {
        wsFlushRaf.current = null;
        flushWsPending();
      });
    }

    function connect() {
      if (cancelled) return;
      setStatus("connecting");
      const socket = new WebSocket(safeWsUrl);
      ws = socket;

      socket.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setStatus("open");
      };

      socket.onmessage = (ev) => {
        if (cancelled) return;
        const raw = typeof ev.data === "string" ? ev.data : "";
        let msg: WsLogMessage;
        try {
          msg = JSON.parse(raw) as WsLogMessage;
        } catch {
          return;
        }
        const sysKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const receivedAt = Date.now();

        if (msg.type === "system") {
          setSystemLines((prev) => {
            const line: SystemLine = {
              kind: "system",
              key: sysKey,
              event: typeof msg.event === "string" ? msg.event : String(msg.event ?? ""),
              message: typeof msg.message === "string" ? msg.message : String(msg.message ?? ""),
            };
            const next = [...prev, line];
            if (next.length <= MAX_SYSTEM) return next;
            return next.slice(next.length - MAX_SYSTEM);
          });
          return;
        }
        if (msg.type === "log") {
          const entryPayload = msg.entry;
          if (entryPayload === null || typeof entryPayload !== "object" || Array.isArray(entryPayload)) {
            return;
          }
          const entry = entryPayload as Record<string, unknown>;
          const nodeId =
            typeof msg.node_id === "number" && Number.isFinite(msg.node_id) ? msg.node_id : 0;
          const nodeName = typeof msg.node_name === "string" ? msg.node_name : "";
          pendingWsEntries.current.push({ nodeId, nodeName, entry, receivedAt });
          scheduleWsFlush();
        }
      };

      socket.onerror = () => {
        if (cancelled) return;
        setStatus("closed");
      };

      socket.onclose = () => {
        ws = null;
        if (wsFlushRaf.current != null) {
          cancelAnimationFrame(wsFlushRaf.current);
          wsFlushRaf.current = null;
        }
        // Drop queued payloads without a final flush (at most one rAF batch). Reconnect resumes tail; v0.1 accepts this loss.
        pendingWsEntries.current = [];
        if (cancelled) return;
        setStatus("closed");
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (wsFlushRaf.current != null) {
        cancelAnimationFrame(wsFlushRaf.current);
        wsFlushRaf.current = null;
      }
      // Unmount: same as onclose — discard pending WS queue (no flush-to-state).
      pendingWsEntries.current = [];
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("liveLogs.title")}</h1>
        <p className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
          <span className="text-muted-foreground">{t("liveLogs.riskNotice")}</span>
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {interpolate(t("liveLogs.connectionStatus"), {
            status,
            max: MAX_MERGED_LOG_LINES,
          })}
        </p>
      </div>

      <section aria-label={t("liveLogs.systemMessages")} className="shrink-0 rounded-md border border-border bg-muted/20">
        <details open className="group">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-muted-foreground">{t("liveLogs.systemMessages")}</span>{" "}
            <Badge variant="secondary" className="ml-1 font-mono text-[10px]">
              {systemLines.length}
            </Badge>
          </summary>
          <ScrollArea className="max-h-36 px-2">
            <ul className="space-y-1 pb-2 font-mono text-[11px] text-muted-foreground">
              {systemLines.length === 0 ? (
                <li className="px-1 py-1 text-muted-foreground">{t("liveLogs.systemEmpty")}</li>
              ) : (
                systemLines.map((line) => (
                  <li key={line.key} className="rounded bg-background/80 px-2 py-1">
                    <Badge variant="outline" className="mr-2 font-mono text-[10px]">
                      {line.event}
                    </Badge>
                    {line.message}
                  </li>
                ))
              )}
            </ul>
          </ScrollArea>
        </details>
      </section>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto"
          onScroll={onTableScroll}
        >
          <table className="w-full min-w-[880px] border-collapse text-left text-xs text-foreground">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-border bg-muted/80 shadow-sm backdrop-blur-sm">
                <th scope="col" className="whitespace-nowrap px-2 py-2 font-medium text-muted-foreground">
                  {t("liveLogs.col.time")}
                </th>
                <th scope="col" className="whitespace-nowrap px-2 py-2 font-medium text-muted-foreground">
                  {t("liveLogs.col.node")}
                </th>
                <th scope="col" className="min-w-[140px] px-2 py-2 font-medium text-muted-foreground">
                  {t("liveLogs.col.request")}
                </th>
                <th scope="col" className="min-w-[160px] px-2 py-2 font-medium text-muted-foreground">
                  {t("liveLogs.col.response")}
                </th>
                <th scope="col" className="min-w-[120px] px-2 py-2 font-medium text-muted-foreground">
                  {t("liveLogs.col.client")}
                </th>
                <th scope="col" className="w-10 px-1 py-2 text-center font-medium text-muted-foreground">
                  <span className="sr-only">{t("liveLogs.col.detailsSr")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {initialLoad === "loading" && logRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    {t("liveLogs.loadingFirst")}
                  </td>
                </tr>
              ) : logRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    {t("liveLogs.empty")}
                  </td>
                </tr>
              ) : (
                <>
                {logRows.map((row) => {
                  const timeStr = formatDisplayTime(row.entry.time, row.receivedAt, locale);
                  const summaryLine = formatResponseSummaryLine(row.normalized);
                  return (
                    <tr
                      key={row.key}
                      className={cn(
                        "border-b border-border/60 transition-colors",
                        resultKindRowClass(row.resultKind),
                        resultKindBorderClass(row.resultKind),
                        slowQueryRowAccentClass(row.slowQuery),
                      )}
                      aria-label={`${resultKindAriaLabel(row.resultKind, locale)}${row.slowQuery ? t("liveLogs.rowAriaSlow") : ""}`}
                    >
                      <td className="whitespace-nowrap px-2 py-1.5 align-top font-mono text-[11px] text-muted-foreground">
                        {timeStr}
                      </td>
                      <td
                        className="max-w-[120px] truncate px-2 py-1.5 align-top text-muted-foreground transition-colors hover:text-foreground"
                        title={row.nodeName}
                      >
                        {row.nodeName}
                        <span className="sr-only"> node id {row.nodeId}</span>
                      </td>
                      <td className="max-w-[220px] px-2 py-1.5 align-top">
                        <div className="truncate font-medium text-foreground" title={row.normalized.requestLine}>
                          {row.normalized.requestLine}
                        </div>
                      </td>
                      <td className="max-w-[260px] px-2 py-1.5 align-top">
                        <div className="truncate text-foreground" title={summaryLine}>
                          {summaryLine}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {row.resultKind !== "neutral" ? (
                            <Badge
                              variant="outline"
                              className="max-w-full truncate border-border/80 font-normal text-[10px] text-foreground"
                              title={resultKindAriaLabel(row.resultKind, locale)}
                            >
                              {resultKindShortLabel(row.resultKind, locale)}
                            </Badge>
                          ) : null}
                          {row.slowQuery ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 font-normal text-[10px] text-foreground"
                              title={t("liveLogs.slowQueryTitle")}
                            >
                              {t("liveLogs.slowQuery")}
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td
                        className="max-w-[180px] px-2 py-1.5 align-top text-left"
                        title={[row.normalized.clientPrimary, row.normalized.clientSecondary]
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        <div className="truncate text-sm font-medium text-foreground" title={row.normalized.clientPrimary}>
                          {row.normalized.clientPrimary}
                        </div>
                        {row.normalized.clientSecondary ? (
                          <div
                            className="truncate font-mono text-[11px] text-muted-foreground"
                            title={row.normalized.clientSecondary}
                          >
                            {row.normalized.clientSecondary}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-1 py-1 align-top text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={t("liveLogs.rowDetailsAria")}
                          onClick={() => setDetail(snapshotLogRow(row))}
                        >
                          <EllipsisVertical className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                <tr aria-hidden className="h-px">
                  <td colSpan={6} className="p-0">
                    <div ref={sentinelRef} className="h-1 w-full" />
                  </td>
                </tr>
                </>
              )}
              {historyStatusMessage ? (
                <tr className="border-t border-border bg-muted/30">
                  <td colSpan={6} className="px-3 py-2 text-center text-muted-foreground">
                    {historyStatusMessage}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent
          side="right"
          className="flex w-full min-h-0 flex-col gap-0 sm:max-w-lg [&>button]:text-foreground"
        >
          {detail ? (
            <>
              <SheetHeader className="shrink-0 border-b border-border pb-3">
                <SheetTitle>{t("liveLogs.sheet.title")}</SheetTitle>
                <SheetDescription className="font-mono text-[11px]">
                  {detail.normalized.requestLine} · {detail.nodeName}
                </SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-xs">
                <div>
                  <div className="text-muted-foreground">{t("liveLogs.sheet.status")}</div>
                  <div className="font-mono text-foreground">{detail.normalized.status}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("liveLogs.sheet.upstreamDns")}</div>
                  <div className="break-all font-mono text-foreground">{detail.normalized.upstream}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("liveLogs.sheet.elapsed")}</div>
                  <div className="font-mono text-foreground">{detail.normalized.elapsedMsLabel}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("liveLogs.sheet.reason")}</div>
                  <div className="break-words text-foreground">{detail.normalized.reason}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("liveLogs.sheet.clientSummary")}</div>
                  <div className="break-words text-sm font-medium text-foreground">{detail.normalized.clientPrimary}</div>
                  {detail.normalized.clientSecondary ? (
                    <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                      {detail.normalized.clientSecondary}
                    </div>
                  ) : null}
                </div>
                {detailSections.map((sec) => (
                  <div key={sec.title}>
                    <div className="text-muted-foreground">{sec.title}</div>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] text-foreground">
                      {sec.body}
                    </pre>
                  </div>
                ))}
                <div className="mt-auto border-t border-border pt-3">
                  <div className="text-sm font-medium text-foreground">{t("liveLogs.sheet.rawJson")}</div>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-2 font-mono text-[10px] text-foreground">
                    {detailJson}
                  </pre>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
