export default function DesiredStatePage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Desired State</h1>
      <p className="text-muted-foreground text-sm">
        Upstream and rewrite editors will be wired in Step 6 (
        <code className="rounded bg-muted px-1">PUT /api/v1/config/global</code>).
      </p>
    </div>
  );
}
