import { DashboardShell } from "@/components/dashboard-shell";
import { FleetNodesProvider } from "@/components/fleet-nodes-provider";
import { RequireAdminGate } from "@/components/require-admin-gate";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAdminGate>
      <FleetNodesProvider>
        <div className="flex min-h-0 flex-1 flex-col">
          <DashboardShell>{children}</DashboardShell>
        </div>
      </FleetNodesProvider>
    </RequireAdminGate>
  );
}
