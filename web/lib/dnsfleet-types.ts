export type AuthKind = "basic" | "bearer";

export interface NodeDTO {
  id: number;
  name: string;
  base_url: string;
  username: string;
  auth_kind: AuthKind;
  online: boolean;
  version: string;
  last_ping_ms: number | null;
  last_sync_at?: number | null;
  drifted: boolean;
  ui_url: string;
  created_at: number;
  updated_at: number;
  /** Last AdGH GET /control/stats at probe; absent or null when offline or unavailable. */
  runtime_dns_queries?: number | null;
  runtime_blocked?: number | null;
  runtime_block_ratio?: number | null;
  runtime_avg_processing_ms?: number | null;
  runtime_stats_at?: number | null;
}

export interface GlobalConfigDTO {
  upstream: string;
  rewrite: unknown[];
}

export interface SyncNodeResult {
  node_id: number;
  ok: boolean;
  error?: string;
}

export interface SyncResponseDTO {
  results: SyncNodeResult[];
  selection: string;
}

export type WsLogMessage =
  | {
      type: "log";
      node_id: number;
      node_name: string;
      entry: Record<string, unknown>;
      /** SHA-256 hex of upstream entry JSON bytes; matches Hub dedupe key for this row when present. */
      fingerprint?: string;
    }
  | {
      type: "system";
      event: string;
      message: string;
      node_id?: number;
      node_name?: string;
    };
