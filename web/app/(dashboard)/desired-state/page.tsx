"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  apiFetch,
  readErrorMessage,
  readJsonBody,
  shouldSkipDuplicate401Toast,
} from "@/lib/api";
import type { GlobalConfigDTO } from "@/lib/dnsfleet-types";

export default function DesiredStatePage() {
  const [upstream, setUpstream] = useState("");
  const [rewriteText, setRewriteText] = useState("[]");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/config/global");
      if (!res.ok) {
        if (!shouldSkipDuplicate401Toast(res)) {
          toast.error(await readErrorMessage(res));
        }
        setUpstream("");
        setRewriteText("[]");
        return;
      }
      const data = await readJsonBody<GlobalConfigDTO>(res);
      if (!data || typeof data !== "object") {
        toast.error("配置响应格式无效");
        setUpstream("");
        setRewriteText("[]");
        return;
      }
      const rw = Array.isArray(data.rewrite) ? data.rewrite : [];
      setUpstream(typeof data.upstream === "string" ? data.upstream : "");
      setRewriteText(JSON.stringify(rw, null, 2));
    } catch {
      toast.error("加载配置失败");
      setUpstream("");
      setRewriteText("[]");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    let rewrite: unknown[];
    try {
      const parsed = JSON.parse(rewriteText) as unknown;
      if (!Array.isArray(parsed)) {
        toast.error("rewrite 须为 JSON 数组");
        return;
      }
      rewrite = parsed;
    } catch {
      toast.error("rewrite JSON 解析失败");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/config/global", {
        method: "PUT",
        body: { upstream, rewrite },
      });
      if (!res.ok) {
        if (!shouldSkipDuplicate401Toast(res)) {
          toast.error(await readErrorMessage(res));
        }
        return;
      }
      toast.success("已保存全局期望");
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col space-y-4 overflow-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Desired State</h1>
        <p className="text-muted-foreground text-sm">
          对应 <code className="rounded bg-muted px-1">GET/PUT /api/v1/config/global</code>
        </p>
      </div>

      <form onSubmit={(e) => void onSave(e)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="upstream">upstream（多行文本）</Label>
          <Textarea
            id="upstream"
            value={upstream}
            onChange={(e) => setUpstream(e.target.value)}
            rows={8}
            className="font-mono text-sm"
            disabled={loading}
            placeholder="例如一行一个上游地址"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rewrite">rewrite（JSON 数组）</Label>
          <Textarea
            id="rewrite"
            value={rewriteText}
            onChange={(e) => setRewriteText(e.target.value)}
            rows={14}
            className="font-mono text-sm"
            disabled={loading}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={loading || saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            重新加载
          </Button>
        </div>
      </form>
    </div>
  );
}
