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
    }
  | {
      type: "system";
      event: string;
      message: string;
      node_id?: number;
      node_name?: string;
    };
