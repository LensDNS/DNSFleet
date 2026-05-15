import type { NodeDTO } from "@/lib/dnsfleet-types";

/** Min interval between automatic full-fleet background probes (session). */
export const FLEET_PROBE_COOLDOWN_MS = 120_000;

export const FLEET_LAST_PROBE_KEY = "dnsfleet.fleet.lastFullProbeAt";

/** Concurrent AdGH probe calls from the Fleet page. */
export const FLEET_PROBE_CONCURRENCY = 2;

export function mergeNodeById(list: NodeDTO[], updated: NodeDTO): NodeDTO[] {
  const i = list.findIndex((n) => n.id === updated.id);
  if (i < 0) return list;
  const next = list.slice();
  next[i] = updated;
  return next;
}

export function fleetProbeCooldownRemainingMs(): number {
  try {
    const last = Number(sessionStorage.getItem(FLEET_LAST_PROBE_KEY) ?? 0);
    if (!Number.isFinite(last) || last <= 0) return 0;
    const rem = FLEET_PROBE_COOLDOWN_MS - (Date.now() - last);
    return rem > 0 ? rem : 0;
  } catch {
    return 0;
  }
}

export function isFleetProbeCooldownActive(): boolean {
  return fleetProbeCooldownRemainingMs() > 0;
}

export function markFleetProbeCompleted(): void {
  try {
    sessionStorage.setItem(FLEET_LAST_PROBE_KEY, String(Date.now()));
  } catch {
    // private mode / quota
  }
}
