# DNSFleet — Web (Step 5)

Next.js (App Router) + Tailwind v4 + shadcn/ui shell. Control plane API lives on Echo; this app uses **same-origin rewrites** so the browser never cross-origin calls `:8080` directly.

## Prerequisites

- **Node** ≥ 20.9 (see `package.json` `engines` and `.nvmrc`).
- **npm** — this workspace was bootstrapped with `npx create-next-app --use-npm` because `pnpm` was not on `PATH`. If you use **pnpm**, run `pnpm import` from `package-lock.json` or re-init lockfiles per your policy; the plan default is **pnpm** when available.
- Control plane: `go run ./cmd/dnsfleet` from repo root with `DNSFLEET_ADMIN_TOKEN` set (or `DNSFLEET_ADMIN_INSECURE_DISABLE=1` for local smoke only).

## Quick start

```bash
cd web
cp .env.example .env.local
# Edit .env.local: DNSFLEET_BACKEND_URL, optionally NEXT_PUBLIC_DNSFLEET_ADMIN_TOKEN
npm install
npm run dev
```

Open `http://localhost:3000` → redirects to `/fleet`.

## Cross-origin strategy (§5.0)

Echo does **not** ship CORS. Default strategy: **`next.config.ts` `rewrites`** so the browser only talks to the Next origin; Next forwards to the control plane.

| Browser path | Proxied to (example `DNSFLEET_BACKEND_URL=http://127.0.0.1:8080`) |
|--------------|---------------------------------------------------------------------|
| `/healthz` | `http://127.0.0.1:8080/healthz` |
| `/api/v1/*` (REST + WS path) | `http://127.0.0.1:8080/api/v1/*` |

**Important:** `destination` is resolved by the **Next server process**, not the browser. In Docker Compose, set `DNSFLEET_BACKEND_URL` to a hostname **reachable from the Next container** (not necessarily `localhost` on the host).

### Environment variables (do not confuse with Go)

| Variable | Where | Meaning |
|----------|-------|---------|
| `DNSFLEET_HTTP_ADDR` | Repo root `.env` for **Go** | Echo listen address, e.g. `:8080` |
| `DNSFLEET_BACKEND_URL` | `web/.env.local` (loaded by Next for `next.config`) | Full origin for rewrites, e.g. `http://127.0.0.1:8080` |

If you change the Echo port, update **both** consistently.

## REST client (`lib/api.ts`)

- Default REST base: **`/api/v1`** (relative). `NEXT_PUBLIC_API_BASE` **unset or `''`** keeps that behavior (explicit empty string — do not rely on vague `if (!base)` checks).
- **Never** set `NEXT_PUBLIC_API_BASE` to the backend origin while using rewrites — the browser would hit Echo directly and hit CORS.
- **`apiFetch(path, …)`:** `path` is appended after that base. Use **`/nodes`** (or `nodes`), not **`/api/v1/nodes`**, or you get a doubled prefix (`/api/v1/api/v1/…`).

## Admin token (dev)

`NEXT_PUBLIC_DNSFLEET_ADMIN_TOKEN` must match **`DNSFLEET_ADMIN_TOKEN`** on the control plane. It is embedded in the client bundle — **dev / controlled networks only**; production should use reverse-proxy injection or Step 6 login patterns (see `api/DNSFLEET_HTTP_API.md`).

## WebSocket (Step 6 handoff)

Under rewrites, open the WebSocket against the **same host as the page**, path **`/api/v1/ws/logs`**:

- Page `http://localhost:3000` → `ws://localhost:3000/api/v1/ws/logs`
- Page `https://…` → `wss://<same-host>/api/v1/ws/logs` (scheme must match)

**Do not** hard-code `ws://127.0.0.1:8080` — that bypasses rewrites and breaks the model.

Auth: prefer `Authorization: Bearer` on the upgrade if possible; query `token=` is allowed by the API doc but leaks in logs — see `api/DNSFLEET_HTTP_API.md`.

### WS smoke (before Step 6 UI)

After `npm run dev` + control plane up, verify **101** on the proxied URL. If **dev** (e.g. Turbopack) behaves oddly but **`npm run build && npm run start`** works, note that for troubleshooting (not a CI gate).

## Step 7 note

`output: 'export'` static hosting **does not** run Next rewrites. You would need a reverse proxy or a different embed strategy (`standalone` + Go, etc.) — out of scope for Step 5.

## Scripts

```bash
npm run dev      # next dev
npm run build    # production build
npm run start    # next start (after build)
npm run lint     # eslint
```

## Git: `web/.env.example`

`web/.gitignore` ignores `.env*` but **un-ignores** `!.env.example` so `web/.env.example` can be committed. From repo root: `git add -n web/.env.example` should show `add 'web/.env.example'`. (Do not use `git check-ignore -v` exit code as the only signal on Windows.)

## Routes (Step 5)

| Path | Purpose |
|------|---------|
| `/` | Redirect → `/fleet` |
| `/fleet` | Dashboard-style placeholders (nodes) |
| `/desired-state` | Placeholder |
| `/live-logs` | Placeholder + WS notes |
