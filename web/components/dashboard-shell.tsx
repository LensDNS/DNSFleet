"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { clearSessionStoredToken, isSkipAdminAuth } from "@/lib/auth-token";

const nav = [
  { href: "/fleet", label: "Fleet" },
  { href: "/desired-state", label: "Desired State" },
  { href: "/live-logs", label: "Live Logs" },
];

function envLabel(): string {
  return process.env.NODE_ENV === "production" ? "prod" : "dev";
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    clearSessionStoredToken();
    router.push("/login");
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
        <div className="px-4 py-3 font-semibold tracking-tight">DNSFleet</div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                pathname === item.href &&
                  "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">DNSFleet</span>
            <span className="rounded border border-border px-1.5 py-0.5 text-xs uppercase">
              {envLabel()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isSkipAdminAuth() ? (
              <span className="text-xs text-amber-600 dark:text-amber-400" title="构建期环境变量">
                SKIP Admin
              </span>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={logout}>
              登出
            </Button>
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
