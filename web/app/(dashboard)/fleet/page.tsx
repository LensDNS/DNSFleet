import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Placeholder nodes for dashboard shell (Step 5); real data in Step 6. */
const placeholderNodes = [
  { name: "US-West-1", online: true, version: "v0.107.x", drifted: false },
  { name: "Home-Lab", online: true, version: "v0.107.x", drifted: true },
  { name: "Edge-1", online: false, version: "—", drifted: false },
];

export default function FleetPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fleet</h1>
        <p className="text-muted-foreground text-sm">
          Node cards are placeholders until Step 6 connects to the API.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {placeholderNodes.map((n) => (
          <Card key={n.name}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{n.name}</CardTitle>
                <span
                  className="inline-flex size-2.5 shrink-0 rounded-full"
                  title={n.online ? "Online" : "Offline"}
                  style={{
                    backgroundColor: n.online ? "oklch(0.65 0.2 145)" : "oklch(0.55 0.2 25)",
                  }}
                />
              </div>
              <CardDescription>
                {n.online ? "Online" : "Offline"} · {n.version}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              {n.drifted ? (
                <span className="text-amber-500">Out of sync (placeholder)</span>
              ) : (
                <span className="text-muted-foreground">In sync (placeholder)</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
