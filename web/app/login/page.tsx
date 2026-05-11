"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiBase, readErrorMessage } from "@/lib/api";
import { isSkipAdminAuth, setSessionStoredToken } from "@/lib/auth-token";
import { useLocale } from "@/lib/i18n/locale-context";

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
  const { t, locale, setLocale } = useLocale();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed && !isSkipAdminAuth()) {
      toast.error(t("login.error.tokenRequired"));
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
      toast.error(err instanceof Error ? err.message : t("login.error.verifyFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6">
      <div className="w-full max-w-sm space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("common.appName")}</h1>
        <p className="text-muted-foreground text-sm">{t("login.subtitle")}</p>
      </div>

      <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
        <Button
          type="button"
          variant={locale === "en" ? "secondary" : "ghost"}
          size="xs"
          className="h-7 px-2 text-xs"
          onClick={() => setLocale("en")}
        >
          EN
        </Button>
        <Button
          type="button"
          variant={locale === "zh" ? "secondary" : "ghost"}
          size="xs"
          className="h-7 px-2 text-xs"
          onClick={() => setLocale("zh")}
        >
          中文
        </Button>
      </div>

      {isSkipAdminAuth() ? (
        <div className="bg-muted text-muted-foreground w-full max-w-sm rounded-lg border p-4 text-sm">
          {t("login.skipAuthIntro")}{" "}
          <code className="text-foreground">NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH=1</code>
          {t("login.skipAuthDetail")}
          <div className="mt-3">
            <Button type="button" onClick={() => router.push("/fleet")}>
              {t("login.enterDashboard")}
            </Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <div className="space-y-2">
          <Label htmlFor="admin-token">{t("login.adminTokenLabel")}</Label>
          <Input
            id="admin-token"
            type="password"
            autoComplete="off"
            placeholder={t("login.placeholderToken")}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t("login.verifying") : t("login.submit")}
        </Button>
      </form>
    </div>
  );
}
