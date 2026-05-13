import type { NormalizedQueryLogEntry, ResultKind } from "@/lib/query-log-display";

/** One merged log line in Live Logs (data plane shape; unchanged by virtualization). */
export type LogRow = {
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
