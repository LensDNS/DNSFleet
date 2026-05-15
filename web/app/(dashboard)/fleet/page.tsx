"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ExternalLinkIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SyncTerminalDrawer } from "@/components/sync-terminal-drawer";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiFetch, readErrorMessage, readJsonBody, shouldSkipDuplicate401Toast } from "@/lib/api";
import type { AuthKind, NodeDTO, SyncResponseDTO } from "@/lib/dnsfleet-types";
import { useFleetNodes } from "@/components/fleet-nodes-provider";
import { fleetProbeCooldownRemainingMs } from "@/lib/fleet-probe";
import { useLocale } from "@/lib/i18n/locale-context";
import { interpolate } from "@/lib/i18n/resolve-message";
import { cn } from "@/lib/utils";

function formatSyncResults(results: SyncResponseDTO["results"]): string {
  return results
    .map((r) =>
      r.ok
        ? `[ok]   node_id=${r.node_id}`
        : `[fail] node_id=${r.node_id}  ${r.error ?? ""}`.trimEnd(),
    )
    .join("\n");
}

export default function FleetPage() {
  const { t } = useLocale();
  const { nodes, loading, fleetProbing, probingIds, refreshNodes, reprobeOne } = useFleetNodes();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalText, setTerminalText] = useState("");

  const [syncAllOpen, setSyncAllOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NodeDTO | null>(null);

  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [authKind, setAuthKind] = useState<AuthKind>("basic");
  const [credential, setCredential] = useState("");

  const probeCooldownRemainingMs = fleetProbeCooldownRemainingMs();

  const snapshotDescription = useMemo(() => {
    if (loading) return t("fleet.snapshot.refreshing");
    if (fleetProbing) {
      const remaining = probingIds.size;
      const done = Math.max(0, nodes.length - remaining);
      return interpolate(t("fleet.snapshot.probingAll"), {
        done: String(done),
        total: String(nodes.length),
      });
    }
    if (probeCooldownRemainingMs > 0 && !fleetProbing) {
      return interpolate(t("fleet.snapshot.probeCooldown"), {
        minutes: String(Math.max(1, Math.ceil(probeCooldownRemainingMs / 60_000))),
      });
    }
    return t("fleet.snapshot.sameRefresh");
  }, [loading, fleetProbing, probingIds.size, nodes.length, probeCooldownRemainingMs, t]);

  const selectedList = useMemo(
    () => nodes.filter((n) => selected.has(n.id)).map((n) => n.id),
    [nodes, selected],
  );

  const fleetSnapshot = useMemo(() => {
    const total = nodes.length;
    const online = nodes.filter((n) => n.online).length;
    const offline = total - online;
    const drifted = nodes.filter((n) => n.drifted).length;
    return { total, online, offline, drifted };
  }, [nodes]);

  function openAdd() {
    setDialogMode("add");
    setEditId(null);
    setName("");
    setBaseUrl("");
    setUsername("");
    setAuthKind("basic");
    setCredential("");
  }

  async function openEdit(n: NodeDTO) {
    setDialogMode("edit");
    setEditId(n.id);
    setFormBusy(true);
    try {
      const res = await apiFetch(`/nodes/${n.id}`);
      if (!res.ok) {
        if (!shouldSkipDuplicate401Toast(res)) {
          toast.error(await readErrorMessage(res));
        }
        setDialogMode(null);
        return;
      }
      const detail = await readJsonBody<NodeDTO>(res);
      if (!detail) {
        toast.error(t("fleet.toast.detailInvalid"));
        setDialogMode(null);
        return;
      }
      setName(detail.name);
      setBaseUrl(detail.base_url);
      setUsername(detail.username);
      setAuthKind(detail.auth_kind);
      setCredential("");
    } catch {
      toast.error(t("fleet.toast.detailLoadFailed"));
      setDialogMode(null);
    } finally {
      setFormBusy(false);
    }
  }

  async function submitNode(e: React.FormEvent) {
    e.preventDefault();
    if (dialogMode === "edit" && editId === null) return;
    const body = {
      name: name.trim(),
      base_url: baseUrl.trim(),
      username: username.trim(),
      auth_kind: authKind,
      credential: credential.trim(),
    };
    setFormBusy(true);
    try {
      if (dialogMode === "add") {
        const res = await apiFetch("/nodes", { method: "POST", body });
        if (res.status === 201) {
          toast.success(t("fleet.toast.created"));
          setDialogMode(null);
          await refreshNodes({ backgroundProbe: false });
          return;
        }
        if (res.status === 422) {
          const j = await readJsonBody<{ message?: string }>(res);
          toast.error(j?.message ?? t("fleet.toast.createFailed"));
          return;
        }
        if (!shouldSkipDuplicate401Toast(res)) {
          toast.error(await readErrorMessage(res));
        }
        return;
      }
      const res = await apiFetch(`/nodes/${editId}`, { method: "PATCH", body });
      if (res.ok) {
        toast.success(t("fleet.toast.updated"));
        setDialogMode(null);
        await refreshNodes({ backgroundProbe: false });
        return;
      }
      if (res.status === 422) {
        const j = await readJsonBody<{ message?: string }>(res);
        toast.error(j?.message ?? t("fleet.toast.updateFailed"));
        return;
      }
      if (!shouldSkipDuplicate401Toast(res)) {
        toast.error(await readErrorMessage(res));
      }
    } finally {
      setFormBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const res = await apiFetch(`/nodes/${deleteTarget.id}`, { method: "DELETE" });
    if (res.status === 204) {
      toast.success(t("fleet.toast.deleted"));
      setDeleteTarget(null);
      selected.delete(deleteTarget.id);
      setSelected(new Set(selected));
      await refreshNodes({ backgroundProbe: false });
      return;
    }
    if (!shouldSkipDuplicate401Toast(res)) {
      toast.error(await readErrorMessage(res));
    }
  }

  async function runSync(body: Record<string, unknown>) {
    const res = await apiFetch("/sync", { method: "POST", body });
    if (!res.ok) {
      if (res.status === 400) {
        const j = await readJsonBody<{ message?: string; unknown_ids?: number[] }>(res);
        const extra =
          j?.unknown_ids && j.unknown_ids.length > 0
            ? interpolate(t("fleet.toast.syncUnknownIds"), {
                ids: j.unknown_ids.join(", "),
              })
            : "";
        toast.error(`${j?.message ?? t("fleet.toast.syncBadRequest")}${extra}`);
        return;
      }
      if (!shouldSkipDuplicate401Toast(res)) {
        toast.error(await readErrorMessage(res));
      }
      return;
    }
    let parsed: SyncResponseDTO;
    try {
      const raw = await readJsonBody<unknown>(res);
      if (
        !raw ||
        typeof raw !== "object" ||
        !Array.isArray((raw as SyncResponseDTO).results)
      ) {
        throw new Error("bad shape");
      }
      parsed = raw as SyncResponseDTO;
    } catch {
      toast.error(t("fleet.toast.syncParseFailed"));
      return;
    }
    const anyFail = parsed.results.some((r) => !r.ok);
    if (!anyFail) {
      toast.success(
        interpolate(t("fleet.toast.syncDone"), {
          selection: parsed.selection,
          count: parsed.results.length,
        }),
      );
    } else {
      toast.warning(t("fleet.toast.syncPartialFail"));
      setTerminalText(formatSyncResults(parsed.results));
      setTerminalOpen(true);
    }
    await refreshNodes({ backgroundProbe: true, quietProbe: false, forceProbe: false });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("fleet.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("fleet.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshNodes({ quietProbe: false, forceProbe: true })}
            disabled={loading || fleetProbing}
          >
            <RefreshCwIcon className="size-4" />
            {t("fleet.refresh")}
          </Button>
          <Button type="button" size="sm" onClick={openAdd}>
            <PlusIcon className="size-4" />
            {t("fleet.addNode")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={selectedList.length === 0}
            onClick={() =>
              void runSync({
                node_ids: [...selectedList].sort((a, b) => a - b),
              })
            }
          >
            {t("fleet.syncSelected")} ({selectedList.length})
          </Button>
          <Button type="button" size="sm" onClick={() => setSyncAllOpen(true)}>
            {t("fleet.syncAllOnline")}
          </Button>
        </div>
      </div>

      {nodes.length > 0 ? (
        <Card
          className={cn("border-dashed", (loading || fleetProbing) && "opacity-80")}
          aria-busy={loading || fleetProbing}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("fleet.snapshot.title")}</CardTitle>
            <CardDescription className="text-xs">{snapshotDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground text-xs">{t("fleet.snapshot.total")}</dt>
                <dd className="text-lg font-semibold tabular-nums">{fleetSnapshot.total}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{t("fleet.snapshot.online")}</dt>
                <dd className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fleetSnapshot.online}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{t("fleet.snapshot.offline")}</dt>
                <dd className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-500">
                  {fleetSnapshot.offline}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{t("fleet.snapshot.drifted")}</dt>
                <dd className="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  {fleetSnapshot.drifted}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {loading && nodes.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("fleet.loadingNodes")}</p>
      ) : nodes.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("fleet.emptyNodes")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {nodes.map((n) => (
            <Card key={n.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={selected.has(n.id)}
                    onCheckedChange={(v) => {
                      const next = new Set(selected);
                      if (v === true) next.add(n.id);
                      else next.delete(n.id);
                      setSelected(next);
                    }}
                    aria-label={interpolate(t("fleet.selectNodeAria"), { name: n.name })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{n.name}</CardTitle>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        {probingIds.has(n.id) ? (
                          <Loader2Icon
                            className="text-muted-foreground size-3.5 animate-spin"
                            aria-hidden
                          />
                        ) : null}
                        <span
                          className="inline-flex size-2.5 rounded-full"
                          title={n.online ? t("fleet.status.online") : t("fleet.status.offline")}
                          style={{
                            backgroundColor: n.online
                              ? "oklch(0.65 0.2 145)"
                              : "oklch(0.55 0.2 25)",
                          }}
                        />
                      </span>
                    </div>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant={n.online ? "default" : "secondary"}>
                        {n.online ? t("fleet.status.online") : t("fleet.status.offline")}
                      </Badge>
                      <span className="truncate">{n.version || "—"}</span>
                      {n.last_ping_ms != null ? (
                        <span className="text-xs">ping {n.last_ping_ms} ms</span>
                      ) : null}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {n.drifted ? (
                  <span className="text-amber-500">{t("fleet.drift.yes")}</span>
                ) : (
                  <span className="text-muted-foreground">{t("fleet.drift.no")}</span>
                )}
                {n.online ? (
                  <div className="space-y-1 border-t border-border pt-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t("fleet.runtime.queries")}</span>
                      <span className="font-mono text-foreground">
                        {n.runtime_dns_queries != null ? String(n.runtime_dns_queries) : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t("fleet.runtime.blocked")}</span>
                      <span className="font-mono text-foreground">
                        {n.runtime_blocked != null ? String(n.runtime_blocked) : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t("fleet.runtime.blockRatio")}</span>
                      <span className="font-mono text-foreground">
                        {n.runtime_block_ratio != null
                          ? `${(n.runtime_block_ratio * 100).toFixed(1)}%`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t("fleet.runtime.avgMs")}</span>
                      <span className="font-mono text-foreground">
                        {n.runtime_avg_processing_ms != null
                          ? `${n.runtime_avg_processing_ms} ms`
                          : "—"}
                      </span>
                    </div>
                    {n.runtime_stats_at == null ? (
                      <p className="text-[10px] leading-snug text-amber-600 dark:text-amber-500 pt-0.5">
                        {t("fleet.runtime.unavailable")}
                      </p>
                    ) : null}
                    <p className="text-[10px] leading-snug text-muted-foreground pt-0.5">
                      {t("fleet.runtime.footnote")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1 border-t border-border pt-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t("fleet.runtime.queries")}</span>
                      <span className="font-mono text-foreground">—</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t("fleet.runtime.blocked")}</span>
                      <span className="font-mono text-foreground">—</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t("fleet.runtime.blockRatio")}</span>
                      <span className="font-mono text-foreground">—</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t("fleet.runtime.avgMs")}</span>
                      <span className="font-mono text-foreground">—</span>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <a
                    href={n.ui_url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      buttonVariants({ variant: "outline", size: "xs" }),
                      "inline-flex gap-1",
                    )}
                  >
                    {t("fleet.openPanel")}
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                  {!n.online ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      disabled={probingIds.has(n.id) || loading}
                      onClick={() => void reprobeOne(n)}
                    >
                      <RefreshCwIcon className="size-3.5" />
                      {t("fleet.reprobe")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void openEdit(n)}
                  >
                    <PencilIcon className="size-3.5" />
                    {t("fleet.edit")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => setDeleteTarget(n)}
                  >
                    <Trash2Icon className="size-3.5" />
                    {t("common.delete")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={dialogMode !== null}
        onOpenChange={(o) => {
          if (!o) setDialogMode(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <form onSubmit={(e) => void submitNode(e)}>
            <DialogHeader>
              <DialogTitle>{dialogMode === "edit" ? t("fleet.dialog.editTitle") : t("fleet.dialog.addTitle")}</DialogTitle>
              <DialogDescription>{t("fleet.dialog.description")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="n-name">name</Label>
                <Input
                  id="n-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-base">base_url</Label>
                <Input
                  id="n-base"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://adguard.example:3000"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-user">username</Label>
                <Input
                  id="n-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required={authKind === "basic"}
                />
              </div>
              <div className="space-y-1.5">
                <Label>auth_kind</Label>
                <Select
                  value={authKind}
                  onValueChange={(v) => setAuthKind(v as AuthKind)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">basic</SelectItem>
                    <SelectItem value="bearer">bearer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-cred">credential</Label>
                <Input
                  id="n-cred"
                  type="password"
                  autoComplete="new-password"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogMode(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={formBusy}>
                {formBusy ? t("fleet.form.submitting") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={syncAllOpen} onOpenChange={setSyncAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("fleet.syncAll.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("fleet.syncAll.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSyncAllOpen(false);
                void runSync({});
              }}
            >
              {t("fleet.syncAll.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("fleet.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? interpolate(t("fleet.delete.description"), {
                    name: deleteTarget.name,
                    id: deleteTarget.id,
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                void confirmDelete();
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SyncTerminalDrawer
        open={terminalOpen}
        onOpenChange={setTerminalOpen}
        text={terminalText}
      />
    </div>
  );
}
