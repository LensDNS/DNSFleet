"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Static export: server `redirect()` is not used; client navigation matches `/` → `/fleet`. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/fleet");
  }, [router]);
  return (
    <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-sm">
      Redirecting…
    </div>
  );
}
