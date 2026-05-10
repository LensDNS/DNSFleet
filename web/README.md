# DNSFleet — Web

Next.js (App Router) + Tailwind v4 + shadcn/ui shell. Control plane API is implemented by Echo.

- **开发**：`next dev` + **`next.config.ts` rewrites**，浏览器只访问 Next 源站；详见下文 **Cross-origin strategy**。
- **生产（默认 MVP）**：静态导出 **`output: 'export'`**，由 Go **`go:embed`** 与 Echo **同端口**提供；**无** Next 进程，**不需要** `DNSFLEET_BACKEND_URL`。REST/WebSocket 使用相对路径 **`/api/v1`**（与 [`lib/api.ts`](lib/api.ts) 默认一致）。

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

## Cross-origin strategy（仅开发）

Echo does **not** ship CORS. **`next dev`** 下默认：**`next.config.ts` `rewrites`**，浏览器只访问 Next 源站，由 Next 转发到控制面。**`output: export`** 的生产构建不会执行 rewrites；嵌入二进制后面板与 API 已同源，无需本节。

| Browser path | Proxied to (example `DNSFLEET_BACKEND_URL=http://127.0.0.1:8080`) |
|--------------|---------------------------------------------------------------------|
| `/healthz` | `http://127.0.0.1:8080/healthz` |
| `/api/v1/*` (REST + WS path) | `http://127.0.0.1:8080/api/v1/*` |

**Important:** `destination` is resolved by the **Next server process**, not the browser. **备选 B（双容器）**：若在 Compose 中单独跑 **`next start`** / standalone，仍可按此表配置 **`DNSFLEET_BACKEND_URL`**（须对 Next 容器可达，不一定是宿主 **`localhost`**）。默认 **单进程嵌入** 镜像不需要第二容器，也不要求 **`DNSFLEET_BACKEND_URL`**。

### Environment variables (do not confuse with Go)

| Variable | Where | Meaning |
|----------|-------|---------|
| `DNSFLEET_HTTP_ADDR` | Repo root `.env` for **Go** | Echo listen address, e.g. `:8080` |
| `DNSFLEET_BACKEND_URL` | `web/.env.local` (loaded by Next for `next.config`) | Full origin for rewrites, e.g. `http://127.0.0.1:8080` |
| `NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH` | `web/.env.local`（dev）或 **Docker `build.args` / `ARG`→`ENV`（生产镜像）** | 仅当值为 **`1`** 时：前端 REST 不带 Admin 头、WS 不带 `token=`；与 **`DNSFLEET_ADMIN_INSECURE_DISABLE=1`** 成对使用。**静态导出会把该值打进 bundle**；改镜像内行为须 **重建镜像** 并在构建阶段注入，**不能**仅靠运行时改容器 `environment`。 |
| `NEXT_PUBLIC_DNSFLEET_ADMIN_TOKEN` | `web/.env.local` | 可选兜底 token（构建期注入）；登录写入的 sessionStorage 优先。 |

If you change the Echo port, update **both** `DNSFLEET_HTTP_ADDR` / `DNSFLEET_BACKEND_URL` consistently.

## REST client (`lib/api.ts`)

- Default REST base: **`/api/v1`** (relative). `NEXT_PUBLIC_API_BASE` **unset or `''`** keeps that behavior (explicit empty string — do not rely on vague `if (!base)` checks).
- **Never** set `NEXT_PUBLIC_API_BASE` to the backend origin while using rewrites — the browser would hit Echo directly and hit CORS.
- **`apiFetch(path, …)`:** `path` is appended after that base. Use **`/nodes`** (or `nodes`), not **`/api/v1/nodes`**, or you get a doubled prefix (`/api/v1/api/v1/…`). Query log proxy: **`/nodes/:id/querylog`**（`lib/node-querylog.ts`）。

## Admin token（Step 6 约定）

登录或设置面板落地后，token 由 **`sessionStorage`**（或 memory）写入，`lib/api.ts` 与 WebSocket URL（Query `token=`）须 **读同一来源**。

**优先级（钉死；后者仅兜底）：**

1. **运行时存储**：若存在已保存的 token（例如登录页写入的 `sessionStorage`），**始终优先**。
2. **`NEXT_PUBLIC_DNSFLEET_ADMIN_TOKEN`**：须与控制面 **`DNSFLEET_ADMIN_TOKEN`** 一致；仅 **本地 / 受控网络 dev 快捷**，进入客户端 bundle — **不得**作为生产唯一鉴权（见 `api/DNSFLEET_HTTP_API.md`）。

### 免 Admin 对照 smoke（仅开发）

控制面若设置 **`DNSFLEET_ADMIN_INSECURE_DISABLE=1`**，Echo **跳过** Admin 校验。前端亦须 **不发送** Admin 头、**WebSocket 不拼** `token=` query，否则会与后端语义不一致。

推荐与后端成对：在 `web/.env.local` 设置 **`NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH=1`**（**须恰好为字符串 `1`**）。此时 `apiFetch` 会强制剥离 `Authorization` / `X-Admin-Token`（即使 session 或 `NEXT_PUBLIC_DNSFLEET_ADMIN_TOKEN` 仍有值）；`buildLogsWebSocketUrl()` 亦不会附加 `token=`。修改任意 **`NEXT_PUBLIC_*`** 后须 **重启 `next dev` 或重新 `next build`**，客户端才能读到新值。

## WebSocket (Step 6 handoff)

Under rewrites, open the WebSocket against the **same host as the page**, path **`/api/v1/ws/logs`**:

- Page `http://localhost:3000` → `ws://localhost:3000/api/v1/ws/logs`
- Page `https://…` → `wss://<same-host>/api/v1/ws/logs` (scheme must match)

**Do not** hard-code `ws://127.0.0.1:8080` — that bypasses rewrites and breaks the model.

Auth: 原生浏览器 WS 往往只能用 Query **`token=`**（与 API 文档一致；Referrer / 代理 access log 风险见 `api/DNSFLEET_HTTP_API.md`）。**`NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH=1`** 时 **不得**附加 `token=`，与后端 insecure 成对。

### WS smoke (before Step 6 UI)

After `npm run dev` + control plane up, verify **101** on the proxied URL. If **dev** (e.g. Turbopack) behaves oddly but **`npm run build && npm run start`** works, note that for troubleshooting (not a CI gate).

## Production build（嵌入二进制 / Docker）

```bash
cd web
npm ci
npm run build   # 产出 web/out；Dockerfile 会拷贝到 internal/webui/dist 再打 Go 二进制
```

Compose 见 [`deploy/docker-compose.yml`](../deploy/docker-compose.yml)（**`build.args`** 与 Dockerfile **`ARG`** 对齐）。**命名卷 + nonroot** 下 SQLite 权限与 **`docker-compose.demo.yml`** 演示合并文件见 [`deploy/README.md`](../deploy/README.md)。

## Scripts

```bash
npm run dev      # next dev
npm run build    # production build
npm run start    # next start (after build)
npm run lint     # eslint
```

## Git: `web/.env.example`

`web/.gitignore` ignores `.env*` but **un-ignores** `!.env.example` so `web/.env.example` can be committed. From repo root: `git add -n web/.env.example` should show `add 'web/.env.example'`. (Do not use `git check-ignore -v` exit code as the only signal on Windows.)

## Routes

| Path | Purpose |
|------|---------|
| `/` | Redirect → `/fleet` |
| `/login` | Admin token 登录（sessionStorage） |
| `/fleet` | 节点列表、增删改、同步、终端抽屉 |
| `/desired-state` | 全局期望 upstream / rewrite |
| `/live-logs` | **REST 首屏 + 滚底** `GET /nodes/:id/querylog`（`older_than`）与 **WebSocket** 尾包合并；按时间新在上 |

**Live Logs 页面**：对 **在线节点** 并行拉首屏 querylog，列表 **按 `entry.time` 降序**（最多 500 条，丢最旧）；滚到底继续 **`older_than`** 分页；若列表高度不足视口会自动追加载直至可滚动或耗尽。多节点 **时间差过大** 时暂停某节点的深翻；**SHA-256**（`node_id` + `JSON.stringify(entry)`）去重 REST 与 WS。表格五列摘要；侧栏 **结构化完整响应**（`question` / `answer` RR / `rules` / `client_info` / `client_proto` 等）+ 底部 **原始 `entry` JSON**。结果行语义色与优先级见 `lib/query-log-display.ts`（`inferResultKind` 等）；`npm test` 含摘要、`entryDetailSections` 与 `lib/live-logs-merge.ts`。

**Hub 尾包 vs REST 条数**：控制面 Hub 单页 `limit` 由环境变量 `DNSFLEET_QUERYLOG_PAGE_LIMIT`（常见 100）决定；浏览器 REST 历史分页默认 `limit=20`。合并列表上条数不必一致，**不是 bug**；详见仓库根 `README.md` 配置表。

**Live Logs 行色与慢查询**：表格行的 `ResultKind` 由 `lib/query-log-display.ts` 的 `inferResultKind` 根据 AdGH 的 `reason` / `status` / `cached` 等推断；常见无空格枚举（如 `FilteredBlackList`、`NotFilteredWhiteList`）有显式映射并对齐上游 `reason.go`，未知值再走正则兜底后回落 `neutral`。**慢查询**徽章使用 AdGH 上报的 `elapsedMs`（解析侧耗时），不是浏览器到控制面的 RTT；默认阈值 100 ms，可用 `NEXT_PUBLIC_DNSFLEET_SLOW_QUERY_MS` 调大以降噪。
