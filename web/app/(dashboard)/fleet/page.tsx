"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalLinkIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";

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
import { mapLimit, probeNode } from "@/lib/nodes";
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
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalText, setTerminalText] = useState("");

  const [syncAllOpen, setSyncAllOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NodeDTO | null>(null);

  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [probeBusyId, setProbeBusyId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [authKind, setAuthKind] = useState<AuthKind>("basic");
  const [credential, setCredential] = useState("");

  const loadNodes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/nodes");
      if (!res.ok) {
        if (!shouldSkipDuplicate401Toast(res)) {
          toast.error(await readErrorMessage(res));
        }
        setNodes([]);
        return;
      }
      const data = await readJsonBody<unknown>(res);
      if (!Array.isArray(data)) {
        toast.error("节点列表格式无效");
        setNodes([]);
        return;
      }
      setNodes(data as NodeDTO[]);
    } catch {
      toast.error("加载节点失败");
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 刷新列表后对离线节点并发探测（上限 2），再拉一次列表（占服务端 AdGHSem，见 API 文档）。 */
  const refreshFleet = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/nodes");
      if (!res.ok) {
        if (!shouldSkipDuplicate401Toast(res)) {
          toast.error(await readErrorMessage(res));
        }
        setNodes([]);
        return;
      }
      const data = await readJsonBody<unknown>(res);
      if (!Array.isArray(data)) {
        toast.error("节点列表格式无效");
        setNodes([]);
        return;
      }
      const list = data as NodeDTO[];
      setNodes(list);
      const offline = list.filter((n) => !n.online);
      if (offline.length > 0) {
        await mapLimit(offline, 2, async (n) => {
          const pr = await probeNode(n.id);
          if (!pr.ok) {
            const msg = await readErrorMessage(pr);
            if (pr.status === 422 || pr.status === 503) {
              toast.warning(`${n.name}: ${msg}`);
            } else if (!shouldSkipDuplicate401Toast(pr)) {
              toast.error(`${n.name}: ${msg}`);
            }
          }
        });
        const res2 = await apiFetch("/nodes");
        if (!res2.ok) {
          if (!shouldSkipDuplicate401Toast(res2)) {
            toast.error(await readErrorMessage(res2));
          }
          return;
        }
        const data2 = await readJsonBody<unknown>(res2);
        if (Array.isArray(data2)) {
          setNodes(data2 as NodeDTO[]);
        }
      }
    } catch {
      toast.error("加载节点失败");
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  async function reprobeOne(n: NodeDTO) {
    setProbeBusyId(n.id);
    try {
      const pr = await probeNode(n.id);
      if (!pr.ok) {
        const msg = await readErrorMessage(pr);
        if (pr.status === 422 || pr.status === 503) {
          toast.warning(msg);
        } else if (!shouldSkipDuplicate401Toast(pr)) {
          toast.error(msg);
        }
        return;
      }
      await loadNodes();
    } finally {
      setProbeBusyId(null);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadNodes());
  }, [loadNodes]);

  const selectedList = useMemo(
    () => nodes.filter((n) => selected.has(n.id)).map((n) => n.id),
    [nodes, selected],
  );

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
        toast.error("节点详情无效");
        setDialogMode(null);
        return;
      }
      setName(detail.name);
      setBaseUrl(detail.base_url);
      setUsername(detail.username);
      setAuthKind(detail.auth_kind);
      setCredential("");
    } catch {
      toast.error("加载节点详情失败");
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
          toast.success("节点已创建");
          setDialogMode(null);
          await loadNodes();
          return;
        }
        if (res.status === 422) {
          const j = await readJsonBody<{ message?: string }>(res);
          toast.error(j?.message ?? "创建失败");
          return;
        }
        if (!shouldSkipDuplicate401Toast(res)) {
          toast.error(await readErrorMessage(res));
        }
        return;
      }
      const res = await apiFetch(`/nodes/${editId}`, { method: "PATCH", body });
      if (res.ok) {
        toast.success("节点已更新");
        setDialogMode(null);
        await loadNodes();
        return;
      }
      if (res.status === 422) {
        const j = await readJsonBody<{ message?: string }>(res);
        toast.error(j?.message ?? "更新失败");
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
      toast.success("节点已删除");
      setDeleteTarget(null);
      selected.delete(deleteTarget.id);
      setSelected(new Set(selected));
      await loadNodes();
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
            ? `（unknown_ids: ${j.unknown_ids.join(", ")}）`
            : "";
        toast.error(`${j?.message ?? "请求错误"}${extra}`);
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
      toast.error("同步响应解析失败");
      return;
    }
    const anyFail = parsed.results.some((r) => !r.ok);
    if (!anyFail) {
      toast.success(
        `同步完成（${parsed.selection}，共 ${parsed.results.length} 条结果）`,
      );
    } else {
      toast.warning("部分节点同步失败");
      setTerminalText(formatSyncResults(parsed.results));
      setTerminalOpen(true);
    }
    await loadNodes();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet</h1>
          <p className="text-muted-foreground text-sm">
            节点列表与同步；勾选后使用「同步已选」。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshFleet()}
            disabled={loading}
          >
            <RefreshCwIcon className="size-4" />
            刷新
          </Button>
          <Button type="button" size="sm" onClick={openAdd}>
            <PlusIcon className="size-4" />
            新增节点
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
            同步已选 ({selectedList.length})
          </Button>
          <Button type="button" size="sm" onClick={() => setSyncAllOpen(true)}>
            同步全部在线
          </Button>
        </div>
      </div>

      {loading && nodes.length === 0 ? (
        <p className="text-muted-foreground text-sm">加载中…</p>
      ) : nodes.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无节点，请点击「新增节点」。</p>
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
                    aria-label={`选择 ${n.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{n.name}</CardTitle>
                      <span
                        className="inline-flex size-2.5 shrink-0 rounded-full"
                        title={n.online ? "Online" : "Offline"}
                        style={{
                          backgroundColor: n.online
                            ? "oklch(0.65 0.2 145)"
                            : "oklch(0.55 0.2 25)",
                        }}
                      />
                    </div>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant={n.online ? "default" : "secondary"}>
                        {n.online ? "在线" : "离线"}
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
                  <span className="text-amber-500">存在配置漂移</span>
                ) : (
                  <span className="text-muted-foreground">与期望一致 · 无漂移</span>
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
                    打开面板
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                  {!n.online ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      disabled={probeBusyId === n.id || loading}
                      onClick={() => void reprobeOne(n)}
                    >
                      <RefreshCwIcon className="size-3.5" />
                      重探测
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void openEdit(n)}
                  >
                    <PencilIcon className="size-3.5" />
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => setDeleteTarget(n)}
                  >
                    <Trash2Icon className="size-3.5" />
                    删除
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
              <DialogTitle>{dialogMode === "edit" ? "编辑节点" : "新增节点"}</DialogTitle>
              <DialogDescription>
                字段名与 API 一致；编辑时须重新填写凭据（credential）。
              </DialogDescription>
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
                取消
              </Button>
              <Button type="submit" disabled={formBusy}>
                {formBusy ? "提交中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={syncAllOpen} onOpenChange={setSyncAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>同步全部在线节点？</AlertDialogTitle>
            <AlertDialogDescription>
              将向所有在线节点下发全局期望配置，确认继续？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSyncAllOpen(false);
                void runSync({});
              }}
            >
              确认同步
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
            <AlertDialogTitle>删除节点？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `将永久删除「${deleteTarget.name}」（id=${deleteTarget.id}），不可恢复。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                void confirmDelete();
              }}
            >
              删除
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
