"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { hasDashboardAccess } from "@/lib/auth-token";
import { useLocale } from "@/lib/i18n/locale-context";

export function RequireAdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { t } = useLocale();
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!hasDashboardAccess()) {
      router.replace("/login");
      queueMicrotask(() => setOk(false));
      return;
    }
    queueMicrotask(() => setOk(true));
  }, [router]);

  if (ok === null) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-sm">
        {t("gate.checkingAccess")}
      </div>
    );
  }
  if (ok === false) {
    return null;
  }
  return <>{children}</>;
}
