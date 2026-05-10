"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiBase, readErrorMessage } from "@/lib/api";
import { isSkipAdminAuth, setSessionStoredToken } from "@/lib/auth-token";

async function probeAdminToken(token: string): Promise<void> {
  if (isSkipAdminAuth()) return;
  const base = getApiBase();
  const url = `${base}/nodes`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new Error(msg);
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed && !isSkipAdminAuth()) {
      toast.error("请输入 Admin token");
      return;
    }
    setBusy(true);
    try {
      if (trimmed && !isSkipAdminAuth()) {
        await probeAdminToken(trimmed);
      }
      if (trimmed) {
        setSessionStoredToken(trimmed);
      }
      router.replace("/fleet");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "校验失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6">
      <div className="w-full max-w-sm space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">DNSFleet</h1>
        <p className="text-muted-foreground text-sm">输入与控制面一致的 Admin token</p>
      </div>

      {isSkipAdminAuth() ? (
        <div className="bg-muted text-muted-foreground w-full max-w-sm rounded-lg border p-4 text-sm">
          已启用 <code className="text-foreground">NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH=1</code>
          ，与后端免 Admin 模式成对使用时可不填 token 直接进入面板。
          <div className="mt-3">
            <Button type="button" onClick={() => router.push("/fleet")}>
              进入面板
            </Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <div className="space-y-2">
          <Label htmlFor="admin-token">Admin token</Label>
          <Input
            id="admin-token"
            type="password"
            autoComplete="off"
            placeholder="Bearer 值（与 DNSFLEET_ADMIN_TOKEN 一致）"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "校验中…" : "登录"}
        </Button>
      </form>
    </div>
  );
}
