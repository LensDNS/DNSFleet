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
  inferRowTone,
  normalizeEntry,
  rowToneBorderClass,
  rowToneRowClass,
  type NormalizedQueryLogEntry,
  type RowTone,
} from "@/lib/query-log-display";
import {
  logRowDedupeKeyHex,
  MAX_MERGED_LOG_LINES,
  mergeSortedDedupeRows,
  recomputePausedDeep,
} from "@/lib/live-logs-merge";
import { fetchNodeQueryLog, fetchNodes } from "@/lib/node-querylog";
import { buildLogsWebSocketUrl } from "@/lib/ws-logs-url";
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
  rowTone: RowTone;
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
    rowTone: inferRowTone(entry),
  };
}

function toneAriaLabel(tone: RowTone): string {
  switch (tone) {
    case "blocked":
      return "拦截";
    case "rewrite":
      return "重写";
    case "allowed":
      return "规则放行";
    default:
      return "正常";
  }
}

export default function LiveLogsPage() {
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

  const detailJson = useMemo(() => {
    if (!detail) return "";
    try {
      return JSON.stringify(detail.entry, null, 2);
    } catch {
      return "";
    }
  }, [detail]);

  const detailSections = useMemo(
    () => (detail ? entryDetailSections(detail.entry) : []),
    [detail],
  );

  const loadOlderPage = useCallback(async () => {
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
      const receivedAt = Date.now();
      const incoming: LogRow[] = [];
      const nodeLabel = rows[pickIdx]?.nodeName ?? `node ${pickedNodeId}`;
      for (const entry of ql.data) {
        incoming.push(await buildLogRow(pickedNodeId, nodeLabel, entry, receivedAt));
      }
      setLogRows((prev) => {
        const merged = mergeSortedDedupeRows(prev, incoming);
        setPausedDeep(recomputePausedDeep(merged));
        return merged;
      });
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
        toast.warning(`加载更早日志失败：${msg}`);
      }
    } finally {
      if (loadOlderAbortRef.current === ac) {
        loadOlderAbortRef.current = null;
      }
      olderInFlight.current.delete(pickedNodeId);
    }
  }, []);

  const onTableScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 100) return;
    void loadOlderPage();
  }, [loadOlderPage]);

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
            toast.warning(`首屏 querylog：${msg}`);
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
        setLogRows(merged);
        setNodeTails(tails);
        setPausedDeep(recomputePausedDeep(merged));
      } catch (e) {
        if (gen !== fetchGen.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("aborted")) toast.error(`加载节点列表失败：${msg}`);
      } finally {
        if (gen === fetchGen.current) setInitialLoad("ready");
      }
    })();

    return () => {
      ac.abort();
    };
  }, []);

  useEffect(() => {
    const built = buildLogsWebSocketUrl();
    if (!built) {
      if (!warnedNoUrl.current && !isSkipAdminAuth()) {
        warnedNoUrl.current = true;
        void Promise.resolve().then(() => {
          toast.error("无可用 Admin token，无法建立日志 WebSocket");
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
          void (async () => {
            const row = await buildLogRow(nodeId, nodeName, entry, receivedAt);
            if (cancelled) return;
            setLogRows((prev) => {
              const merged = mergeSortedDedupeRows(prev, [row]);
              setPausedDeep(recomputePausedDeep(merged));
              return merged;
            });
          })();
        }
      };

      socket.onerror = () => {
        if (cancelled) return;
        setStatus("closed");
      };

      socket.onclose = () => {
        ws = null;
        if (cancelled) return;
        setStatus("closed");
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Live Logs</h1>
        <p className="rounded-md border border-amber-600/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          风险提示：实时日志经同源 WebSocket；有 Admin 时 token 可能出现在 Query 中（勿分享链接、勿在生产依赖裸
          Query）。自动重连采用指数退避（上限 30s）。首屏与滚底经 REST 拉取历史，WS 推送增量；列表按时间新在上。
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          连接状态：{status}（合并最多 {MAX_MERGED_LOG_LINES} 条）
        </p>
      </div>

      <section aria-label="系统消息" className="shrink-0 rounded-md border border-border bg-muted/20">
        <details open className="group">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-muted-foreground">系统消息</span>{" "}
            <Badge variant="secondary" className="ml-1 font-mono text-[10px]">
              {systemLines.length}
            </Badge>
          </summary>
          <ScrollArea className="max-h-36 px-2">
            <ul className="space-y-1 pb-2 font-mono text-[11px] text-muted-foreground">
              {systemLines.length === 0 ? (
                <li className="px-1 py-1 text-zinc-500">（暂无）</li>
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-zinc-950/80">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto"
          onScroll={onTableScroll}
        >
          <table className="w-full min-w-[880px] border-collapse text-left text-xs text-zinc-100">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-border bg-zinc-950 shadow-sm">
                <th scope="col" className="whitespace-nowrap px-2 py-2 font-medium text-zinc-400">
                  时间
                </th>
                <th scope="col" className="whitespace-nowrap px-2 py-2 font-medium text-zinc-400">
                  节点
                </th>
                <th scope="col" className="min-w-[140px] px-2 py-2 font-medium text-zinc-400">
                  请求
                </th>
                <th scope="col" className="min-w-[160px] px-2 py-2 font-medium text-zinc-400">
                  响应
                </th>
                <th scope="col" className="min-w-[120px] px-2 py-2 font-medium text-zinc-400">
                  客户端
                </th>
                <th scope="col" className="w-10 px-1 py-2 text-center font-medium text-zinc-400">
                  <span className="sr-only">响应细节</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {initialLoad === "loading" && logRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    正在加载首屏日志…
                  </td>
                </tr>
              ) : logRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    暂无在线节点或无查询日志。连接 WebSocket 后可接收实时尾包。
                  </td>
                </tr>
              ) : (
                logRows.map((row) => {
                  const timeStr = formatDisplayTime(row.entry.time, row.receivedAt);
                  const summaryLine = formatResponseSummaryLine(row.normalized);
                  return (
                    <tr
                      key={row.key}
                      className={cn(
                        "border-b border-border/60 transition-colors",
                        rowToneRowClass(row.rowTone),
                        rowToneBorderClass(row.rowTone),
                      )}
                      aria-label={toneAriaLabel(row.rowTone)}
                    >
                      <td className="whitespace-nowrap px-2 py-1.5 align-top font-mono text-[11px] text-zinc-300">
                        {timeStr}
                      </td>
                      <td className="max-w-[120px] truncate px-2 py-1.5 align-top text-cyan-300" title={row.nodeName}>
                        {row.nodeName}
                        <span className="sr-only"> node id {row.nodeId}</span>
                      </td>
                      <td className="max-w-[220px] px-2 py-1.5 align-top">
                        <div className="truncate font-medium text-zinc-100" title={row.normalized.requestLine}>
                          {row.normalized.requestLine}
                        </div>
                      </td>
                      <td className="max-w-[260px] px-2 py-1.5 align-top">
                        <div className="truncate text-zinc-200" title={summaryLine}>
                          {summaryLine}
                        </div>
                        {row.rowTone !== "neutral" ? (
                          <span className="mt-0.5 inline-block text-[10px] text-muted-foreground">
                            [{toneAriaLabel(row.rowTone)}]
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[160px] truncate px-2 py-1.5 align-top font-mono text-[11px]" title={row.normalized.client}>
                        {row.normalized.client}
                      </td>
                      <td className="px-1 py-1 align-top text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-zinc-400 hover:text-zinc-100"
                          aria-label="响应细节与原始 JSON"
                          onClick={() => setDetail(snapshotLogRow(row))}
                        >
                          <EllipsisVertical className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
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
                <SheetTitle>响应细节</SheetTitle>
                <SheetDescription className="font-mono text-[11px]">
                  {detail.normalized.requestLine} · {detail.nodeName}
                </SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-xs">
                <div>
                  <div className="text-muted-foreground">状态 / 响应代码</div>
                  <div className="font-mono text-foreground">{detail.normalized.status}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">上游 DNS</div>
                  <div className="break-all font-mono text-foreground">{detail.normalized.upstream}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">耗时</div>
                  <div className="font-mono text-foreground">{detail.normalized.elapsedMsLabel}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">原因</div>
                  <div className="break-words text-foreground">{detail.normalized.reason}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">客户端</div>
                  <div className="break-all font-mono text-foreground">{detail.normalized.client}</div>
                </div>
                {detailSections.map((sec) => (
                  <div key={sec.title}>
                    <div className="text-muted-foreground">{sec.title}</div>
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-100">
                      {sec.body}
                    </pre>
                  </div>
                ))}
                <div className="mt-auto border-t border-border pt-3">
                  <div className="text-sm font-medium text-foreground">原始 entry（JSON）</div>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-zinc-100">
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
