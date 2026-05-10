# DNSFleet

**Unified Control Plane for AdGuard Home Fleets.**  
多节点 AdGuard Home 的统一控制面（v0.1 开发中）。

## 文档与协作说明

产品需求、开发路线图、AI 分步提示、审查提示及根目录 **`AGENTS.md`** 等 **仅存维护者本机**，**不**纳入本 Git 远程（见仓库根目录 `.gitignore` 说明）。克隆本仓库若需相同资料，请从维护者提供的私有渠道获取。

## 仓库布局（代码）

| 路径 | 说明 |
|------|------|
| `cmd/dnsfleet/` | Go 可执行入口 |
| `internal/` | 应用私有代码 |
| `api/` | 预留 API 契约 |
| `web/` | 前端（Next.js）；开发与联调见 [`web/README.md`](web/README.md) |
| `deploy/` | Docker 与 Compose（见 [`deploy/README.md`](deploy/README.md)） |
| `scripts/` | 可选脚本 |

## Configuration

进程通过环境变量配置（开发时可复制 [`.env.example`](.env.example) 为 `.env` 并自行导出；当前实现使用 `os.Getenv`，不自动加载 `.env` 文件）。

| 变量 | 默认 | 说明 |
|------|------|------|
| `DNSFLEET_DB_PATH` | `./data/dnsfleet.db` | SQLite **数据库文件**路径（环境变量可为相对路径；`config.Load` 会解析为**绝对路径**再交给后续 Open，避免工作目录变化导致找不到库）；不支持 `:memory:` / `file::memory:`；父目录在 `Load` 时创建 |
| `DNSFLEET_HTTP_ADDR` | `:8080` | HTTP 监听地址（Echo 监听该地址） |
| `DNSFLEET_ADMIN_TOKEN` | （默认必填） | 单用户 Admin 共享密钥（`Authorization: Bearer` 或 `X-Admin-Token`）。**未**设置 `DNSFLEET_ADMIN_INSECURE_DISABLE=1` 且 token 为空（仅空白）时进程启动失败 |
| `DNSFLEET_ADMIN_INSECURE_DISABLE` | 未设置 | 仅当值**精确为** `1` 时跳过 Admin 校验且**不要求** token 非空。**禁止在生产或公开镜像中启用** |
| `DNSFLEET_SYNC_MAX_CONCURRENT` | `8` | 对 AdGuard Home 的 HTTP 并发上限；**漂移循环**、**`POST /api/v1/sync`** 与 **`GET /api/v1/nodes/:id/querylog`**（Live Logs 历史分页代理）**共用**同一 semaphore（任意时刻经该槽位的飞行请求数 ≤ 该值） |
| `DNSFLEET_SYNC_TOTAL_TIMEOUT` | `5m` | 单次 `POST /api/v1/sync` 的总超时（`time.ParseDuration` 语法；非法则启动失败） |
| `DNSFLEET_DRIFT_INTERVAL` | `5m` | 漂移检测周期（语法同上）。进程启动后**先立即跑一轮**漂移，再按该间隔 ticker 重复 |
| `DNSFLEET_QUERYLOG_MAX_CONCURRENT` | `8` | （Step 4）**Hub** 对 AdGH **`GET /control/querylog`** 轮询的并发上限；**与** `DNSFLEET_SYNC_MAX_CONCURRENT` **独立**。浏览器经 **`GET /api/v1/nodes/:id/querylog`** 拉历史时走 **另一路**（`AdGHSem`）。峰值对 AdGH 的飞行请求约为 **两路槽位之和**（调度相关） |
| `DNSFLEET_QUERYLOG_POLL_INTERVAL` | `2s` | （Step 4）每节点 Hub 轮询周期（Go duration；非法则启动失败） |
| `DNSFLEET_QUERYLOG_PAGE_LIMIT` | `100` | （Step 4）Hub **单页尾包**每次 `GET /control/querylog` 的 `limit`（非法则启动失败）；与 REST 代理默认 `limit=20`、上限 100 **不必相同** |
| `DNSFLEET_WS_MAX_FRAME_BYTES` | `65536` | （Step 4）发往浏览器的 WebSocket **文本帧**最大字节数（非法则启动失败） |

业务 REST 路径前缀（v0.1 裁决）：**`/api/v1`**（健康检查仍为 **`GET /healthz`**，不经 Admin）。实时日志 WebSocket：**`GET /api/v1/ws/logs`**（Upgrade；鉴权见 [`api/DNSFLEET_HTTP_API.md`](api/DNSFLEET_HTTP_API.md)）。

**实时查询日志（Live Logs）**：Hub 对在线节点 **每 tick 单页** `GET /control/querylog`（尾包），经 WebSocket **fan-out**；**深历史**由浏览器调用 **`GET /api/v1/nodes/:id/querylog`**（`older_than` 分页，与 Hub **独立**并发槽位）拉取；页面按 `entry.time` **合并排序**（新在上）。**不是** AdGH 原生 push。尾包延迟 **大致**为 **`DNSFLEET_QUERYLOG_POLL_INTERVAL` + 排队 + RTT**（与 [`api/DNSFLEET_HTTP_API.md`](api/DNSFLEET_HTTP_API.md) 一致）。每个 WS 客户端有 **有界出站队列**；满则丢最旧积压并 **`system` + `backpressure_drop`**（§4.G）。

## Run

`go run ./cmd/dnsfleet`（或 `go build -o bin/dnsfleet ./cmd/dnsfleet` 后运行二进制）。启动时初始化 SQLite 并 `AutoMigrate`，构造 **`internal/querylog` Hub**（与漂移同源根 `context`），注册 **`GET /healthz`**（不经 Admin）、**`/api/v1/ws/logs`**（WebSocket，经 `AdminWS`）与 **`/api/v1`** REST（经 Admin，见 [`api/DNSFLEET_HTTP_API.md`](api/DNSFLEET_HTTP_API.md)）。HTTP 在独立 goroutine 监听；主 goroutine 等待 **SIGINT/SIGTERM** 后先 **`cancel`** 根 context（停止漂移与 **querylog Hub 轮询**），再 **`e.Shutdown`**。**健康检查**：`GET /healthz` → `200`，响应体纯文本 `ok`。

生产形态（默认）：Web UI 为 Next **静态导出**，由 **`go:embed`**（`all:dist`，否则 **`_next/`** 不会进包，见 [`internal/webui/embed.go`](internal/webui/embed.go) 注释）打进二进制并在 **同一端口** 与 API 一并提供（无独立 Next 进程）。本地修改前端后须先在 `web/` 执行 **`npm run build`**，再同步到 [`internal/webui/dist`](internal/webui/dist)（见 **`Makefile` `ensure-webui-dist`** 或 [`scripts/ensure-webui-dist.ps1`](scripts/ensure-webui-dist.ps1)），然后 **`go run -a ./cmd/dnsfleet`** 或重新 **`go build`**，否则可能仍使用缓存里旧的嵌入资源。

### Docker / Compose（一键运行）

在仓库根目录执行（构建上下文为仓库根，Compose 文件在 `deploy/`）：

```bash
docker compose -f deploy/docker-compose.yml up --build
```

默认映射 **`8080:8080`**，与 **`DNSFLEET_HTTP_ADDR=:8080`** 一致。SQLite 使用命名卷挂载到容器内 **`/data`**，**`DNSFLEET_DB_PATH`** 指向 **`/data/dnsfleet.db`**（见 [`deploy/docker-compose.yml`](deploy/docker-compose.yml)）。镜像以 **distroless nonroot（UID 65532）** 运行，**干净环境下命名卷常为 root 属主**，可能导致数据库无法创建；见 [`deploy/README.md`](deploy/README.md)（**卷 `chown`** 或与 **`deploy/docker-compose.demo.yml`** 合并以 **仅演示** 用 root 运行）。构建参数（**`NEXT_PUBLIC_*`** 须在 **镜像构建阶段** 注入）亦在该文档中说明。

若在 **Nginx / Caddy** 等后面终止 TLS 或反代，须正确转发 **WebSocket**（**`Upgrade`**、**`Connection`**），否则 Live Logs（**`/api/v1/ws/logs`**）无法连接；路径与鉴权见 [`api/DNSFLEET_HTTP_API.md`](api/DNSFLEET_HTTP_API.md)。

## 开发验收（Step 1.6）

在仓库根目录执行（与维护者本机 `docs/详细开发计划.md` 第 1.6 节一致；**不**自动加载 `.env` 时须自行导出变量）。

嵌入 UI 后 **`go test`** 需要 **`internal/webui/dist`** 非空：请先 **`make ensure-webui-dist`**（Unix / Git Bash），或 **`powershell -File scripts/ensure-webui-dist.ps1`**（Windows），再运行测试；或直接 **`make test`**（内部会先 `ensure-webui-dist`）。

```bash
go fmt ./...
go vet ./cmd/... ./internal/...
go test ./cmd/... ./internal/...
go build -o bin/dnsfleet ./cmd/dnsfleet
```

在 **Windows** 上，构建产物多为 `bin\dnsfleet.exe`；`bin/` 已列入 `.gitignore`。请勿在仓库根对全局执行 **`go test ./...`**：若存在 **`web/node_modules`**，可能扫到无关 Go 包导致失败；请限定 **`./cmd/... ./internal/...`** 或使用 **`make test`**。

## 状态

Step 1、Step 2 已验收；**Step 3** 控制面 HTTP（`/api/v1`、Admin、节点 CRUD、全局配置、同步、漂移）已实现；**Step 4** 观测面（WebSocket、`GET /control/querylog` 轮询聚合、Hub fan-out）行为以本仓库代码与 [`api/DNSFLEET_HTTP_API.md`](api/DNSFLEET_HTTP_API.md) 为准；**Step 7** 静态嵌入 UI + **`deploy/`** Docker 多阶段构建与 Compose 已落地。裁决全文见维护者本机 `docs/详细开发计划.md`。

## 许可证

[MIT](LICENSE)
