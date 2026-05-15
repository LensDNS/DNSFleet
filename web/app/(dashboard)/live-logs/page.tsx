"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isSkipAdminAuth } from "@/lib/auth-token";
import type { NodeDTO, WsLogMessage } from "@/lib/dnsfleet-types";
import {
  entryDetailSections,
  entryTimeToMs,
  formatDisplayTime,
  inferResultKind,
  isSlowQuery,
  normalizeEntry,
} from "@/lib/query-log-display";
import {
  isWsFingerprintHex,
  logRowDedupeKeyFromWsFingerprint,
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

import type { LogRow } from "./log-row-model";
import { LogTableRow } from "./log-table-row";

const MAX_SYSTEM = 100;

/** sessionStorage: another tab may have opened WS recently (multi-tab awareness; each tab still connects). */
const LIVE_LOGS_TAB_ACTIVE_KEY = "dnsfleet.liveLogs.wsActiveAt";

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

function buildLogRowSync(
  nodeId: number,
  nodeName: string,
  entry: Record<string, unknown>,
  receivedAt: number,
  fingerprint: string,
): LogRow {
  const dedupeKey = logRowDedupeKeyFromWsFingerprint(nodeId, fingerprint);
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

async function buildLogRow(
  nodeId: number,
  nodeName: string,
  entry: Record<string, unknown>,
  receivedAt: number,
  fingerprint?: string,
): Promise<LogRow> {
  const dedupeKey =
    fingerprint !== undefined && isWsFingerprintHex(fingerprint)
      ? logRowDedupeKeyFromWsFingerprint(nodeId, fingerprint)
      : await logRowDedupeKeyHex(nodeId, entry);
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

/** Stable token for `entry.time` so first-row summary deps track display-relevant changes. */
function stableEntryTimeToken(entryTime: unknown): string {
  try {
    return JSON.stringify(entryTime);
  } catch {
    return String(entryTime);
  }
}

/** Max concurrent `logRowDedupeKeyHex` (SHA-256) calls per WS batch without fingerprint (PR4 client path). */
const WS_DIGEST_CONCURRENCY = 3;

type WsPendingEntry = {
  nodeId: number;
  nodeName: string;
  entry: Record<string, unknown>;
  receivedAt: number;
  fingerprint?: string;
};

async function buildLogRowsDigestLimited(items: WsPendingEntry[]): Promise<LogRow[]> {
  if (items.length === 0) return [];
  const results: (LogRow | undefined)[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) break;
      try {
        const it = items[idx];
        results[idx] = await buildLogRow(it.nodeId, it.nodeName, it.entry, it.receivedAt, it.fingerprint);
      } catch {
        // skip one malformed row
      }
    }
  };
  const pool = Math.min(WS_DIGEST_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  const out: LogRow[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r !== undefined) out.push(r);
  }
  return out;
}

type LogRowsModel = { logRows: LogRow[]; pausedDeep: Record<number, boolean> };

type LogRowsDispatchAction =
  | { type: "applyMerged"; merged: LogRow[] }
  | { type: "setBoth"; logRows: LogRow[]; pausedDeep: Record<number, boolean> };

function logRowsReducer(state: LogRowsModel, action: LogRowsDispatchAction): LogRowsModel {
  switch (action.type) {
    case "applyMerged":
      return { logRows: action.merged, pausedDeep: recomputePausedDeep(action.merged) };
    case "setBoth":
      return { logRows: action.logRows, pausedDeep: action.pausedDeep };
    default:
      return state;
  }
}

export default function LiveLogsPage() {
  const { t, locale } = useLocale();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [logRowsModel, dispatchLogRows] = useReducer(logRowsReducer, {
    logRows: [] as LogRow[],
    pausedDeep: {} as Record<number, boolean>,
  });
  const { logRows, pausedDeep } = logRowsModel;

  const [systemLines, setSystemLines] = useState<SystemLine[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [multiTabHint, setMultiTabHint] = useState(false);
  const [detail, setDetail] = useState<LogRow | null>(null);
  const [initialLoad, setInitialLoad] = useState<"loading" | "ready">("loading");
  const [nodeTails, setNodeTails] = useState<Record<number, NodeTailState>>({});
  const [fleetNodes, setFleetNodes] = useState<NodeDTO[]>([]);
  const [logScopeFilter, setLogScopeFilter] = useState<string>("all");

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
  /** After user scrolls near the bottom once, short-viewport autoFill may chase `older_than` (see autoFill effect). */
  const userEngagedBottomRef = useRef(false);
  const pageSession = useRef(0);
  const visibleRowsRef = useRef<LogRow[]>([]);
  const pendingWsEntries = useRef<
    {
      nodeId: number;
      nodeName: string;
      entry: Record<string, unknown>;
      receivedAt: number;
      fingerprint?: string;
    }[]
  >([]);
  const wsFlushRaf = useRef<number | null>(null);

  const onlineNodeIds = useMemo(
    () => new Set(fleetNodes.filter((n) => n.online).map((n) => n.id)),
    [fleetNodes],
  );

  const visibleRows = useMemo(() => {
    if (logScopeFilter === "all") return logRows;
    if (logScopeFilter === "online") {
      return logRows.filter((r) => onlineNodeIds.has(r.nodeId));
    }
    if (!logScopeFilter.startsWith("node:")) return logRows;
    const nid = Number(logScopeFilter.slice("node:".length));
    if (!Number.isFinite(nid)) return logRows;
    return logRows.filter((r) => r.nodeId === nid);
  }, [logRows, logScopeFilter, onlineNodeIds]);

  // TanStack's virtualizer identity can change every render; drive layout/resize measure() via ref
  // so effects do not resubscribe every frame. React Compiler skips memoizing this hook (see eslint below).
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack useVirtualizer; measure paths use rowVirtualizerRef
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 6,
  });
  const rowVirtualizerRef = useRef(rowVirtualizer);
  rowVirtualizerRef.current = rowVirtualizer;

  const openDetailForRowKey = useCallback((key: string) => {
    const found = logRowsRef.current.find((r) => r.key === key);
    if (found) setDetail(snapshotLogRow(found));
  }, []);

  const onLogTbodyClick = useCallback(
    (e: MouseEvent<HTMLTableSectionElement>) => {
      const el = (e.target as HTMLElement | null)?.closest("[data-action=\"detail\"][data-row-key]");
      if (!el) return;
      const key = el.getAttribute("data-row-key");
      if (!key) return;
      openDetailForRowKey(key);
    },
    [openDetailForRowKey],
  );

  /** Delegated keyboard for non-`<button>` detail controls; native `<button>` keeps browser Enter/Space. */
  const onLogTbodyKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableSectionElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl) return;
      const el = targetEl.closest<HTMLElement>("[data-action=\"detail\"][data-row-key]");
      if (!el) return;
      if (el instanceof HTMLButtonElement) return;
      if (e.key === " ") e.preventDefault();
      const key = el.getAttribute("data-row-key");
      if (!key) return;
      openDetailForRowKey(key);
    },
    [openDetailForRowKey],
  );

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
    visibleRowsRef.current = visibleRows;
  }, [visibleRows]);

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

    const rows = visibleRowsRef.current;
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
    // Throttle deep-history fetches; autoFill + IO share this path.
    olderCooldownUntil.current = Date.now() + 1200;

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
      dispatchLogRows({ type: "applyMerged", merged });
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
        toast.warning(`${tRef.current("liveLogs.toast.loadOlderFailed")} ${msg}`);
      }
    } finally {
      globalOlderBusy.current = false;
      if (loadOlderAbortRef.current === ac) {
        loadOlderAbortRef.current = null;
      }
      olderInFlight.current.delete(pickedNodeId);
    }
  }, []);

  const onTableScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist <= 100) {
      userEngagedBottomRef.current = true;
    }
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
    const inScope = (id: number) => {
      if (logScopeFilter === "all") return true;
      if (logScopeFilter === "online") return onlineNodeIds.has(id);
      if (!logScopeFilter.startsWith("node:")) return true;
      const want = Number(logScopeFilter.slice("node:".length));
      return Number.isFinite(want) && id === want;
    };
    const scoped = ids.filter(inScope);
    if (scoped.length === 0) return null;
    const exhausted = scoped.filter((id) => {
      const s = nodeTails[id];
      return !s || s.exhausted || s.nextOlderThan === null;
    });
    if (exhausted.length === 0) return null;
    if (exhausted.length === scoped.length) {
      return t("liveLogs.history.allExhausted");
    }
    return t("liveLogs.history.partialExhausted");
  }, [nodeTails, logScopeFilter, onlineNodeIds, t]);

  useLayoutEffect(() => {
    if (logRows.length === 0 || initialLoad !== "ready") return;
    const id = requestAnimationFrame(() => {
      rowVirtualizerRef.current.measure();
    });
    return () => cancelAnimationFrame(id);
  }, [logRows.length, initialLoad, locale, historyStatusMessage, visibleRows.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      rowVirtualizerRef.current.measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [initialLoad]);

  useEffect(() => {
    if (logRows.length !== prevLogLen.current) {
      prevLogLen.current = logRows.length;
      autoFillBursts.current = 0;
    }
  }, [logRows.length]);

  /**
   * When the table is shorter than the viewport, optionally chase `older_than` until scrollable or exhausted.
   * Only the first chase runs without a user scroll-to-bottom gesture; further bursts require
   * `userEngagedBottomRef` (scroll within 100px of bottom) so we do not hammer `older_than` while the user has not engaged.
   */
  useEffect(() => {
    if (initialLoad !== "ready") return;
    const el = scrollRef.current;
    if (!el || logRows.length === 0) return;
    const short = el.scrollHeight <= el.clientHeight + 8;
    if (!short) return;
    if (!userEngagedBottomRef.current && autoFillBursts.current >= 1) return;
    if (autoFillBursts.current >= 9) return;
    autoFillBursts.current += 1;
    void loadOlderPage();
  }, [logRows.length, nodeTails, initialLoad, loadOlderPage, visibleRows.length]);

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
  }, [logRows.length, nodeTails, initialLoad, loadOlderPage, visibleRows.length, historyStatusMessage]);

  useEffect(() => {
    const gen = ++fetchGen.current;
    const ac = new AbortController();

    void (async () => {
      setInitialLoad("loading");
      userEngagedBottomRef.current = false;
      try {
        const nodes = await fetchNodes(ac.signal);
        if (gen !== fetchGen.current) return;
        setFleetNodes(nodes);
        const online = nodes.filter((n) => n.online);
        if (online.length === 0) {
          setNodeTails({});
          dispatchLogRows({ type: "setBoth", logRows: [], pausedDeep: {} });
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
            toast.warning(`${tRef.current("liveLogs.toast.firstPageWarn")} ${msg}`);
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
        dispatchLogRows({ type: "applyMerged", merged });
        setNodeTails(tails);
      } catch (e) {
        if (gen !== fetchGen.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("aborted")) toast.error(`${tRef.current("liveLogs.toast.nodesLoadFailed")} ${msg}`);
      } finally {
        if (gen === fetchGen.current) setInitialLoad("ready");
      }
    })();

    return () => {
      ac.abort();
    };
  }, [locale]);

  useEffect(() => {
    const built = buildLogsWebSocketUrl();
    if (!built) {
      if (!warnedNoUrl.current && !isSkipAdminAuth()) {
        warnedNoUrl.current = true;
        void Promise.resolve().then(() => {
          toast.error(tRef.current("liveLogs.toast.noWsToken"));
          setStatus("idle");
        });
      }
      return;
    }
    const safeWsUrl: string = built;

    let cancelled = false;
    /**
     * Promise tail inside this effect: serializes every post-`splice` path that does digest + merge + `applyWsMerged`.
     * `flushWsPending` and the async remainder of `flushPendingOnDisconnect` enqueue here so batches run FIFO even if
     * another `requestAnimationFrame` fires while a prior `await buildLogRowsDigestLimited` is still in flight.
     */
    let wsFlushTail: Promise<void> = Promise.resolve();
    const enqueueWsPostSpliceWork = (run: () => Promise<void>) => {
      wsFlushTail = wsFlushTail.then(run).catch((err: unknown) => {
        // Keep the tail alive: do not stall later batches if one digest/merge throws.
        if (process.env.NODE_ENV === "development") {
          console.error("[live-logs] wsFlushTail digest/merge failed", err);
        }
      });
    };
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function scheduleReconnect() {
      if (cancelled) return;
      const maxMs = 30_000;
      const base = 1000;
      const delay = Math.min(maxMs, base * 2 ** Math.min(attempt, 5));
      attempt += 1;
      setReconnectAttempt(attempt);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function applyWsMerged(merged: LogRow[]) {
      if (cancelled) return;
      logRowsRef.current = merged;
      dispatchLogRows({ type: "applyMerged", merged });
    }

    /**
     * Drain pending WS rows (e.g. on socket close/error or effect cleanup).
     * Fingerprint rows merge **synchronously** so `locale`/unmount cleanup can still apply them before `cancelled`
     * suppresses enqueued async work. Digest-only remainder is serialized on the same `wsFlushTail` chain as live `flushWsPending`.
     * That sync step can still interleave with an in-flight digest job for a narrow window vs global strict FIFO;
     * fully serializing fingerprint merges too would require enqueueing them and revisiting cleanup/`cancelled` order.
     */
    function flushPendingOnDisconnect() {
      const batch = pendingWsEntries.current.splice(0);
      if (batch.length === 0) return;
      const syncBuilt: LogRow[] = [];
      const asyncRemainder: typeof batch = [];
      for (const item of batch) {
        if (item.fingerprint !== undefined && isWsFingerprintHex(item.fingerprint)) {
          try {
            syncBuilt.push(
              buildLogRowSync(item.nodeId, item.nodeName, item.entry, item.receivedAt, item.fingerprint),
            );
          } catch {
            // skip malformed
          }
        } else {
          asyncRemainder.push(item);
        }
      }
      if (syncBuilt.length > 0) {
        const merged = mergeNewestFirstDedupeIncremental(logRowsRef.current, syncBuilt);
        applyWsMerged(merged);
      }
      if (asyncRemainder.length === 0) return;
      enqueueWsPostSpliceWork(async () => {
        if (cancelled) return;
        const built = await buildLogRowsDigestLimited(asyncRemainder);
        if (cancelled || built.length === 0) return;
        const merged = mergeNewestFirstDedupeIncremental(logRowsRef.current, built);
        applyWsMerged(merged);
      });
    }

    function flushWsPending() {
      const batch = pendingWsEntries.current.splice(0);
      if (batch.length === 0) return;
      enqueueWsPostSpliceWork(async () => {
        if (cancelled) return;
        const built = await buildLogRowsDigestLimited(batch);
        if (cancelled || built.length === 0) return;
        const merged = mergeNewestFirstDedupeIncremental(logRowsRef.current, built);
        applyWsMerged(merged);
      });
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
        setReconnectAttempt(0);
        setStatus("open");
        try {
          const now = Date.now();
          const raw = sessionStorage.getItem(LIVE_LOGS_TAB_ACTIVE_KEY);
          if (raw) {
            const prev = Number(raw);
            if (Number.isFinite(prev) && now - prev < 8000 && now - prev > 30) {
              setMultiTabHint(true);
            }
          }
          sessionStorage.setItem(LIVE_LOGS_TAB_ACTIVE_KEY, String(now));
        } catch {
          // ignore private mode / quota
        }
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
          const fingerprint = typeof msg.fingerprint === "string" ? msg.fingerprint : undefined;
          pendingWsEntries.current.push({ nodeId, nodeName, entry, receivedAt, fingerprint });
          scheduleWsFlush();
        }
      };

      socket.onerror = () => {
        if (cancelled) return;
        if (wsFlushRaf.current != null) {
          cancelAnimationFrame(wsFlushRaf.current);
          wsFlushRaf.current = null;
        }
        flushPendingOnDisconnect();
        setStatus("closed");
      };

      socket.onclose = () => {
        ws = null;
        if (wsFlushRaf.current != null) {
          cancelAnimationFrame(wsFlushRaf.current);
          wsFlushRaf.current = null;
        }
        flushPendingOnDisconnect();
        if (cancelled) return;
        setStatus("closed");
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      if (wsFlushRaf.current != null) {
        cancelAnimationFrame(wsFlushRaf.current);
        wsFlushRaf.current = null;
      }
      flushPendingOnDisconnect();
      cancelled = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [locale]);

  const firstRowSummaryKey = useMemo(() => {
    const last = visibleRows[0];
    if (!last) return "";
    return `${last.dedupeKey}\t${last.timeMs}\t${last.receivedAt ?? ""}\t${stableEntryTimeToken(last.entry.time)}`;
  }, [visibleRows]);

  const operatorLastLog = useMemo(() => {
    if (!firstRowSummaryKey) return "—";
    const last = visibleRows[0];
    if (!last) return "—";
    return formatDisplayTime(last.entry.time, last.receivedAt, locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- firstRowSummaryKey captures visible row-0 identity for tail churn.
  }, [firstRowSummaryKey, locale]);

  const operatorSummary = useMemo(() => {
    const tail = systemLines.slice(-20);
    const counts = new Map<string, number>();
    for (const ln of tail) {
      counts.set(ln.event, (counts.get(ln.event) ?? 0) + 1);
    }
    const parts: string[] = [];
    for (const k of [
      "backpressure_drop",
      "upstream_error",
      "upstream_warn",
      "frame_too_large",
      "querylog_disabled",
    ]) {
      const n = counts.get(k);
      if (n) parts.push(`${k}×${n}`);
    }
    const events = parts.length > 0 ? parts.join(", ") : "—";
    return interpolate(t("liveLogs.operatorSummary"), {
      status,
      lastLog: operatorLastLog,
      attempt: reconnectAttempt,
      events,
    });
  }, [operatorLastLog, systemLines, status, reconnectAttempt, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0">
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
        <p className="text-muted-foreground mt-1 text-xs font-mono leading-snug">{operatorSummary}</p>
        {multiTabHint ? (
          <p className="text-muted-foreground mt-0.5 text-xs">{t("liveLogs.multiTabHint")}</p>
        ) : null}
        <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">{t("liveLogs.mergeReorderNote")}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Label htmlFor="live-logs-scope" className="text-muted-foreground shrink-0 text-xs">
            {t("liveLogs.scope.label")}
          </Label>
          <Select
            value={logScopeFilter}
            onValueChange={(v) => {
              if (v != null && v !== "") setLogScopeFilter(v);
            }}
          >
            <SelectTrigger id="live-logs-scope" className="w-full sm:max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("liveLogs.scope.all")}</SelectItem>
              <SelectItem value="online">{t("liveLogs.scope.onlineOnly")}</SelectItem>
              {fleetNodes
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((n) => (
                  <SelectItem key={n.id} value={`node:${n.id}`}>
                    {interpolate(t("liveLogs.scope.nodeOption"), { name: n.name, id: String(n.id) })}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground mt-1 text-[11px] leading-snug">{t("liveLogs.scope.footer")}</p>
      </div>

      <section aria-label={t("liveLogs.systemMessages")} className="shrink-0 rounded-md border border-border bg-muted/20">
        <details className="group">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-muted-foreground">{t("liveLogs.systemMessages")}</span>{" "}
            <Badge variant="secondary" className="ml-1 font-mono text-[10px]">
              {systemLines.length}
            </Badge>
          </summary>
          <div className="max-h-36 overflow-y-auto px-2 pb-2">
            <ul className="space-y-1 font-mono text-[11px] text-muted-foreground">
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
          </div>
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
            <tbody onClick={onLogTbodyClick} onKeyDown={onLogTbodyKeyDown}>
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
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    {t("liveLogs.scope.filterEmpty")}
                  </td>
                </tr>
              ) : (
                <>
                  {(() => {
                    const v = rowVirtualizer;
                    const items = v.getVirtualItems();
                    const padTop = items[0]?.start ?? 0;
                    const last = items[items.length - 1];
                    const padBottomRaw =
                      items.length > 0 ? v.getTotalSize() - last.end : v.getTotalSize();
                    const padBottom = Math.max(padBottomRaw, 4);
                    return (
                      <>
                        {padTop > 0 ? (
                          <tr aria-hidden>
                            <td colSpan={6} style={{ height: padTop }} className="p-0" />
                          </tr>
                        ) : null}
                        {items.map((vi) => {
                          const row = visibleRows[vi.index];
                          if (!row) return null;
                          return (
                            <LogTableRow
                              key={row.key}
                              row={row}
                              locale={locale}
                              virtualIndex={vi.index}
                              measureElement={v.measureElement}
                              rowHeightPx={vi.size}
                              detailAriaLabel={t("liveLogs.rowDetailsAria")}
                              slowQueryLabel={t("liveLogs.slowQuery")}
                              slowQueryTitle={t("liveLogs.slowQueryTitle")}
                              rowAriaSlowSuffix={t("liveLogs.rowAriaSlow")}
                            />
                          );
                        })}
                        <tr aria-hidden>
                          <td
                            colSpan={6}
                            style={{ height: padBottom }}
                            className="relative box-border p-0 align-top"
                          >
                            <div className="flex h-full min-h-0 flex-col justify-end">
                              <div ref={sentinelRef} className="h-1 w-full shrink-0" />
                            </div>
                          </td>
                        </tr>
                      </>
                    );
                  })()}
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
