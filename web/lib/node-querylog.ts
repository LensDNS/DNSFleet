import { apiFetch, readErrorMessage, readJsonBody } from "@/lib/api";
import type { NodeDTO } from "@/lib/dnsfleet-types";

/** AdGH QueryLog shape returned by `GET /api/v1/nodes/:id/querylog`. */
export interface QueryLogResponseDTO {
  oldest: string;
  /** Each element is one query-log entry object (AdGH schema). */
  data: Record<string, unknown>[];
}

export type FetchNodeQueryLogParams = {
  older_than?: string;
  /** Default 20 on server; max 100. */
  limit?: number;
  /** Only 0 is allowed; omit to use 0. */
  offset?: number;
  response_status?: string;
  search?: string;
  signal?: AbortSignal;
};

export async function fetchNodes(signal?: AbortSignal): Promise<NodeDTO[]> {
  const res = await apiFetch("/nodes", { signal });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const body = await readJsonBody<NodeDTO[]>(res);
  return Array.isArray(body) ? body : [];
}

/**
 * Proxied GET /control/querylog for one node (Admin).
 * v1 Live Logs uses empty search and response_status=all at the call site.
 */
export async function fetchNodeQueryLog(
  nodeId: number,
  params: FetchNodeQueryLogParams = {},
): Promise<QueryLogResponseDTO> {
  const sp = new URLSearchParams();
  if (params.older_than !== undefined && params.older_than !== "") {
    sp.set("older_than", params.older_than);
  }
  if (params.limit !== undefined) {
    sp.set("limit", String(params.limit));
  }
  if (params.offset !== undefined && params.offset !== 0) {
    sp.set("offset", String(params.offset));
  }
  if (params.response_status !== undefined && params.response_status !== "") {
    sp.set("response_status", params.response_status);
  }
  if (params.search !== undefined && params.search !== "") {
    sp.set("search", params.search);
  }
  const q = sp.toString();
  const path = q ? `/nodes/${nodeId}/querylog?${q}` : `/nodes/${nodeId}/querylog`;
  const res = await apiFetch(path, {
    signal: params.signal,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const body = await readJsonBody<QueryLogResponseDTO>(res);
  if (!body || typeof body !== "object") {
    throw new Error("empty querylog response");
  }
  const oldest = typeof body.oldest === "string" ? body.oldest : "";
  const rawData = body.data;
  const data = Array.isArray(rawData)
    ? rawData.map((row) =>
        row !== null && typeof row === "object" && !Array.isArray(row)
          ? (row as Record<string, unknown>)
          : {},
      )
    : [];
  return { oldest, data };
}
