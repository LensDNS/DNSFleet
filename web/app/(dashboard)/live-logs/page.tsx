export default function LiveLogsPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Live Logs</h1>
      <p className="text-muted-foreground text-sm">
        Step 6: connect a WebSocket to the <strong>same origin</strong> path{" "}
        <code className="rounded bg-muted px-1">/api/v1/ws/logs</code> (use{" "}
        <code className="rounded bg-muted px-1">ws:</code> or{" "}
        <code className="rounded bg-muted px-1">wss:</code> matching the page scheme
        plus <code className="rounded bg-muted px-1">window.location.host</code>
        ). Do not hard-code <code className="rounded bg-muted px-1">ws://127.0.0.1:8080</code>.
      </p>
    </div>
  );
}
