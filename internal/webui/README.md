# webui (embedded static frontend)

The control plane serves the dashboard by embedding **`dist/`** via **`go:embed`**.

## Populate `dist/`

- **Docker / release**: the image build copies `web/out` → `internal/webui/dist` before `go build`.
- **Local**: from the repo root, run:

  ```bash
  make ensure-webui-dist
  ```

  or after `cd web && npm run build`, copy `web/out/*` into `internal/webui/dist/`.

`go:embed` requires a **non-empty** `dist/`. If you only run `go test` / `go build` without a prior `web` build, `make ensure-webui-dist` writes a minimal `index.html` placeholder so the tree compiles.

## Next static export

`web/next.config` uses `output: "export"`. `rewrites()` are for `next dev` only; the embedded site uses same-origin `/api/v1` (no Next server in production).

For `HEAD` on static paths, `serve.go` returns **HTTP 200** with an empty body via `echo.NoContent(http.StatusOK)` — not HTTP 204. See `deploy/README.md` if documenting CDN expectations.
