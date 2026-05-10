"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isSkipAdminAuth } from "@/lib/auth-token";
import type { WsLogMessage } from "@/lib/dnsfleet-types";
import { buildLogsWebSocketUrl } from "@/lib/ws-logs-url";

const MAX_LINES = 500;

type Line =
  | { kind: "log"; key: string; nodeName: string; text: string; highlight: boolean }
  | { kind: "system"; key: string; event: string; message: string };

function entryHighlight(entry: Record<string, unknown>): boolean {
  const s = JSON.stringify(entry).toLowerCase();
  if (s.includes("cached")) return true;
  if (typeof entry.reason === "string" && entry.reason) return true;
  return false;
}

function formatLogLine(msg: Extract<WsLogMessage, { type: "log" }>): {
  text: string;
  highlight: boolean;
} {
  const hi = entryHighlight(msg.entry);
  const text = JSON.stringify(msg.entry);
  return { text, highlight: hi };
}

export default function LiveLogsPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const warnedNoUrl = useRef(false);

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

    function pushLine(line: Line) {
      setLines((prev) => {
        const next = [...prev, line];
        if (next.length <= MAX_LINES) return next;
        return next.slice(next.length - MAX_LINES);
      });
    }

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
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        if (msg.type === "system") {
          pushLine({
            kind: "system",
            key,
            event: msg.event,
            message: msg.message,
          });
          return;
        }
        if (msg.type === "log") {
          const { text, highlight } = formatLogLine(msg);
          pushLine({
            kind: "log",
            key,
            nodeName: msg.node_name,
            text,
            highlight,
          });
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
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
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
          Query）。自动重连采用指数退避（上限 30s）。
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          连接状态：{status}（最多保留 {MAX_LINES} 行）
        </p>
      </div>

      <ScrollArea className="min-h-[420px] flex-1 rounded-md border border-border bg-zinc-950/80 p-2 font-mono text-xs text-zinc-100">
        <ul className="space-y-1">
          {lines.map((line) =>
            line.kind === "system" ? (
              <li key={line.key}>
                <details className="rounded bg-zinc-900/80 px-2 py-1">
                  <summary className="cursor-pointer text-zinc-400">
                    <Badge variant="outline" className="mr-2 font-mono text-[10px]">
                      {line.event}
                    </Badge>
                    {line.message}
                  </summary>
                </details>
              </li>
            ) : (
              <li
                key={line.key}
                className={
                  line.highlight
                    ? "border-l-2 border-amber-500 pl-2 text-amber-100"
                    : "border-l-2 border-transparent pl-2"
                }
              >
                <span className="text-cyan-400">[{line.nodeName}]</span>{" "}
                <span className="break-all">{line.text}</span>
              </li>
            ),
          )}
        </ul>
      </ScrollArea>
    </div>
  );
}
