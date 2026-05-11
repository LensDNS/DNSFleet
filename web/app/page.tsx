"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useLocale } from "@/lib/i18n/locale-context";

/** Static export: server `redirect()` is not used; client navigation matches `/` → `/fleet`. */
export default function Home() {
  const router = useRouter();
  const { t } = useLocale();
  useEffect(() => {
    router.replace("/fleet");
  }, [router]);
  return (
    <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-sm">
      {t("common.redirecting")}
    </div>
  );
}
