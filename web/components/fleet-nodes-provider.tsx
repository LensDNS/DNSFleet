"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { apiFetch, readErrorMessage, readJsonBody, shouldSkipDuplicate401Toast } from "@/lib/api";
import { isSkipAdminAuth } from "@/lib/auth-token";
import type { NodeDTO } from "@/lib/dnsfleet-types";
import {
  FLEET_PROBE_CONCURRENCY,
  isFleetProbeCooldownActive,
  markFleetProbeCompleted,
  mergeNodeById,
} from "@/lib/fleet-probe";
import { mapLimit, probeNodeDto } from "@/lib/nodes";

/** How often to check whether fleet probe cooldown has elapsed (any dashboard route). */
const PROBE_TICK_MS = 15_000;
/** Refresh node list from SQLite without probing (picks up hub mark-offline, etc.). */
const NODES_LIST_TICK_MS = 30_000;

export type FleetNodesRefreshOptions = {
  backgroundProbe?: boolean;
  quietProbe?: boolean;
  forceProbe?: boolean;
};

type FleetNodesContextValue = {
  nodes: NodeDTO[];
  loading: boolean;
  fleetProbing: boolean;
  probingIds: ReadonlySet<number>;
  refreshNodes: (options?: FleetNodesRefreshOptions) => Promise<void>;
  reprobeOne: (node: NodeDTO) => Promise<void>;
  mergeNode: (updated: NodeDTO) => void;
};

const FleetNodesContext = createContext<FleetNodesContextValue | null>(null);

export function FleetNodesProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [fleetProbing, setFleetProbing] = useState(false);
  const [probingIds, setProbingIds] = useState<Set<number>>(() => new Set());
  const fleetProbeGen = useRef(0);
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const fetchNodesList = useCallback(async (): Promise<NodeDTO[] | null> => {
    const res = await apiFetch("/nodes");
    if (!res.ok) {
      if (!shouldSkipDuplicate401Toast(res)) {
        toast.error(await readErrorMessage(res));
      }
      return null;
    }
    const data = await readJsonBody<unknown>(res);
    if (!Array.isArray(data)) {
      return null;
    }
    return data as NodeDTO[];
  }, []);

  const mergeNode = useCallback((updated: NodeDTO) => {
    setNodes((prev) => mergeNodeById(prev, updated));
  }, []);

  const toastProbeFailure = useCallback(
    (nodeName: string, status: number, message: string, quiet: boolean) => {
      if (quiet) return;
      if (status === 422 || status === 503) {
        toast.warning(`${nodeName}: ${message}`);
      } else if (!(isSkipAdminAuth() && status === 401)) {
        toast.error(`${nodeName}: ${message}`);
      }
    },
    [],
  );

  const reprobeAllInBackground = useCallback(
    async (list: NodeDTO[], options?: { quiet?: boolean; force?: boolean }) => {
      if (list.length === 0) return;
      if (!options?.force && isFleetProbeCooldownActive()) return;

      const gen = ++fleetProbeGen.current;
      const quiet = options?.quiet === true;
      setFleetProbing(true);
      setProbingIds(new Set(list.map((n) => n.id)));
      try {
        await mapLimit(list, FLEET_PROBE_CONCURRENCY, async (n) => {
          if (fleetProbeGen.current !== gen) return;
          const result = await probeNodeDto(n.id);
          if (fleetProbeGen.current !== gen) return;
          if (result.node) {
            setNodes((prev) => mergeNodeById(prev, result.node!));
          }
          setProbingIds((prev) => {
            const next = new Set(prev);
            next.delete(n.id);
            return next;
          });
          if (!result.ok && result.message) {
            toastProbeFailure(n.name, result.status, result.message, quiet);
          }
        });
        if (fleetProbeGen.current === gen) {
          markFleetProbeCompleted();
        }
      } finally {
        if (fleetProbeGen.current === gen) {
          setFleetProbing(false);
          setProbingIds(new Set());
        }
      }
    },
    [toastProbeFailure],
  );

  const refreshNodes = useCallback(
    async (options?: FleetNodesRefreshOptions) => {
      const backgroundProbe = options?.backgroundProbe !== false;
      const quietProbe = options?.quietProbe === true;
      const forceProbe = options?.forceProbe === true;
      setLoading(true);
      try {
        const list = await fetchNodesList();
        if (list !== null) {
          setNodes(list);
        }
        if (list === null) return;
        if (backgroundProbe) {
          void reprobeAllInBackground(list, { quiet: quietProbe, force: forceProbe });
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchNodesList, reprobeAllInBackground],
  );

  const reprobeOne = useCallback(
    async (n: NodeDTO) => {
      setProbingIds((prev) => new Set(prev).add(n.id));
      try {
        const result = await probeNodeDto(n.id);
        if (result.node) {
          setNodes((prev) => mergeNodeById(prev, result.node!));
        }
        if (!result.ok && result.message) {
          toastProbeFailure(n.name, result.status, result.message, false);
        }
      } finally {
        setProbingIds((prev) => {
          const next = new Set(prev);
          next.delete(n.id);
          return next;
        });
      }
    },
    [toastProbeFailure],
  );

  useEffect(() => {
    void Promise.resolve().then(() => refreshNodes({ quietProbe: true, forceProbe: false }));
    return () => {
      fleetProbeGen.current += 1;
    };
  }, [refreshNodes]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (isFleetProbeCooldownActive()) return;
      const list = nodesRef.current;
      if (list.length === 0) return;
      void reprobeAllInBackground(list, { quiet: true, force: false });
    }, PROBE_TICK_MS);
    return () => window.clearInterval(id);
  }, [reprobeAllInBackground]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (fleetProbing) return;
      void (async () => {
        const list = await fetchNodesList();
        if (list !== null) {
          setNodes(list);
        }
      })();
    }, NODES_LIST_TICK_MS);
    return () => window.clearInterval(id);
  }, [fetchNodesList, fleetProbing]);

  const value = useMemo(
    (): FleetNodesContextValue => ({
      nodes,
      loading,
      fleetProbing,
      probingIds,
      refreshNodes,
      reprobeOne,
      mergeNode,
    }),
    [nodes, loading, fleetProbing, probingIds, refreshNodes, reprobeOne, mergeNode],
  );

  return <FleetNodesContext.Provider value={value}>{children}</FleetNodesContext.Provider>;
}

export function useFleetNodes(): FleetNodesContextValue {
  const ctx = useContext(FleetNodesContext);
  if (!ctx) {
    throw new Error("useFleetNodes must be used within FleetNodesProvider");
  }
  return ctx;
}
