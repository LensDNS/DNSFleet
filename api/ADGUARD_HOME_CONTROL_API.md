# AdGuard Home — 控制面 HTTP API（DNSFleet 实现依据）

> **地位**：v0.1 起，DNSFleet 与 AdGuard Home（AdGH）控制面交互的 **唯一权威说明**（与 `internal/adguard` 实现一致）。  
> **来源**：以 AdGuard Home 仓库内 **OpenAPI**（`openapi/openapi.yaml`）与 **`openapi/CHANGELOG.md`** 为主；Wiki 无独立 REST 手册页；`AGHTechDoc.md` 仅作背景，与实现冲突时 **以 OpenAPI + `internal/home` 源码为准**。  
> **本地对照**：可在本机克隆 AdGH 仓库；若置于 `DNSFleet/AdGuardHome/`，该目录已在根 `.gitignore` 中忽略，勿提交。

---

## 官方信息来源（URL）

| 资源 | 说明 |
|------|------|
| `https://github.com/AdguardTeam/AdGuardHome/blob/master/openapi/openapi.yaml` | 主 OpenAPI 规范（`servers`、`paths`、`components`） |
| `https://github.com/AdguardTeam/AdGuardHome/blob/master/openapi/CHANGELOG.md` | API 与版本对应、弃用与字段演进 |
| `https://github.com/AdguardTeam/AdGuardHome/wiki` | Wiki 首页（FAQ/配置等，**非** REST 专章） |
| `https://github.com/AdguardTeam/AdGuardHome/blob/master/AGHTechDoc.md` | 内部技术叙述；**登录 Cookie 名等可能与当前实现不一致**（见下文） |

**实现交叉验证（AdGH 源码路径，相对 AdGH 仓库根）**

- `internal/home/authhttp.go` — 会话 Cookie 名、中间件、`needsAuthentication`
- `internal/home/control.go` — `Content-Type: application/json` 校验等
- `internal/home/authglinet.go` — GL.iNet OEM 变体（与普通发行版不同）

---

## 1）认证方式与路径前缀

| 方式 | 说明 |
|------|------|
| **路径前缀** | OpenAPI `servers` 为 `url: /control`，即面板 HTTP API 典型前缀为 **`/control/...`**，再拼各 path（如 `/control/status`）。 |
| **HTTP Basic** | OpenAPI 全局 `security: basicAuth`；`securitySchemes` 为 `type: http`, `scheme: basic`。有管理员账户时，客户端使用 **`Authorization: Basic <base64(user:password)>`**。 |
| **Cookie 会话** | `POST /control/login` 成功后服务端 `Set-Cookie`；默认中间件优先读 Cookie **`agh_session`**，否则再尝试 Basic。Cookie：`Path=/`，`HttpOnly`，`SameSite=Lax`，约 **365 天** TTL（源码常量，以 `authhttp.go` 为准）。 |
| **登出** | `GET /control/logout`：302 到 `login.html` 并清除会话 Cookie。 |
| **Bearer Token** | 官方 OpenAPI 的 `securitySchemes` **未**声明 Bearer；默认中间件取用户时 **仅** Cookie 或 Basic，**未发现** `Authorization: Bearer ...` 作为一等契约。若产品需要「类 Bearer」，视为 **非官方 OpenAPI 契约**（除非自行前置代理或对接变体）。 |
| **无认证** | 配置中 **未创建任何 Web 用户** 时，中间件认为不需要认证（`needsAuthentication` 为假），控制 API 可不携带凭据访问。 |
| **GL.iNet 等 OEM** | `Admin-Token` Cookie + 令牌文件的专用中间件；**与普通发行版不同**（`authglinet.go`）。 |

**与 AGHTechDoc.md 的差异**：该文档「登录」一节若仍写 `Cookie: session=...`，与当前实现中的 **`agh_session`** 不一致；**以 `authhttp.go` 为准**。

**写操作常见必需 Header**：对 `POST`/`PUT` 等带 JSON 正文的接口，服务端会校验 **`Content-Type: application/json`**（见 `internal/home/control.go` 中 `ensureContentType`）。

---

## 2）「在线」与「软件版本」

### 本机已安装版本 + 运行态（推荐用于 DNSFleet 探测）

| 项 | 值 |
|----|-----|
| **路径** | `GET /control/status` |
| **Method** | `GET` |
| **Header** | 有 Web 用户时：Basic 或有效 `agh_session`；无用户时可无认证。 |
| **成功 JSON（要点）** | `version`：当前运行的 AdGH 版本字符串；`running`：DNS 是否在运行；另有 `dns_addresses`、`dns_port`、`http_port`、`protection_enabled`、`language` 等。`start_time`：Web API 进程启动时间（**Unix 毫秒**）。 |
| **OpenAPI 细节（核对）** | `ServerStatus` 的 **`required`** 另含 **`protection_disabled_until`**（与上表「要点」未逐字对齐；实现反序列化时须按 **OpenAPI `components.schemas.ServerStatus`** 为准）。历史上曾出现 **`required` 列出 `protection_disabled_until` 而在同 schema `properties` 中无同名定义** 的自洽问题（同名完整定义可能在 `DNSConfig` 等其它 schema）；**以当前 `openapi.yaml` + 运行时 JSON 为准**；若严格 OpenAPI 校验失败应查上游 issue / 生成器。 |
| **版本线索** | `start_time`：`openapi/CHANGELOG.md` 记为 **v0.107.70** 起新增。`GET /control/status` 本身在 CHANGELOG 中早于 v0.102 已存在并演进。 |

示例（结构示意）：

```json
{
  "version": "v0.107.x",
  "running": true,
  "dns_addresses": ["127.0.0.1"],
  "dns_port": 53,
  "http_port": 3000,
  "protection_enabled": true,
  "language": "zh-cn",
  "start_time": 1700000000000
}
```

### 「是否有新版本」（非本机已安装版本号）

| 项 | 值 |
|----|-----|
| **路径** | `POST /control/version.json` |
| **Method** | `POST` |
| **Body** | `GetVersionRequest` 仅含 `recheck_now` 属性；**schema 无 `required` 数组**（字段可按需省略；示例 `{"recheck_now": true}` 为常见用法）。 |
| **语义** | 获取 **线上最新可用版本** 等信息；**不是**读取本机已安装版本。**本机版本**请用 **`GET /control/status` 的 `version`**。 |

### 统计快照（`Stats` · DNSFleet v0.1.4 节点卡片）

| 项 | 值 |
|----|-----|
| **路径** | `GET /control/stats` |
| **Method** | `GET` |
| **Query** | 可选 **`recent`**（OpenAPI）；**DNSFleet v0.1.4 默认不传**，使用 AdGH 已配置的 statistics interval 内的聚合。 |
| **成功 JSON（要点）** | OpenAPI **`Stats`**。DNSFleet 当前映射：`num_dns_queries`（int64）、`num_blocked_filtering`（int64）、`avg_processing_time`（**秒**，float）。其它字段（`top_queried_domains`、`dns_queries` 时间序列等）**不**在控制面节点卡片展示。 |
| **语义** | 节点自报告的 **runtime 统计周期** 内计数；**不是** DNSFleet 持久化历史；控制面仅在 **probe** 成功时读一次并缓存到 SQLite 供 `GET /api/v1/nodes` 展示。 |

---

## 3）上游 DNS（upstream）

| 操作 | 路径 | Method | 说明 |
|------|------|--------|------|
| **读取** | `/control/dns_info` | `GET` | OpenAPI：`GET /dns_info` 响应为 **`allOf` [`DNSConfig`, object]**，其中 extension object 仅额外声明 **`default_local_ptr_upstreams`**（与 `DNSConfig.properties` 内的 **`local_ptr_upstreams`** 等字段并存；名称不同，**以 `openapi.yaml` 为准**）。`DNSConfig` 含 **`upstream_dns`：`string[]`**、`bootstrap_dns`、`fallback_dns`、`upstream_dns_file`、`upstream_mode`、`upstream_timeout` 等。 |
| **写入** | `/control/dns_config` | `POST` | 请求体 `application/json` 的 **`DNSConfig`**（与 `dns_info` 同类字段）；`upstream_dns` 为 **JSON 数组**，元素为 **字符串**。 |
| **连通性测试** | `/control/test_upstream_dns` | `POST` | Body：`UpstreamsConfig`（至少含 `bootstrap_dns`、`upstream_dns` 等）；响应对每个上游返回状态映射。 |

**列表编码**：请求/响应中均为 **JSON 数组 `[]`**，元素为 **字符串**（可含 `tls://`、`https://`、`tcp://`、纯 IP、可选端口等，以 OpenAPI 字段说明为准）。

**`DNSConfig`**：`components.schemas.DNSConfig` **无顶层 `required` 数组**（字段是否必填以各 path 的 requestBody / 服务端校验为准）；字段名与本文列举的 **一致**，细节以 yaml 为准。

**版本线索**：`GET`/`POST` `dns_info` / `dns_config` 与 `upstream_dns` 等在 **`openapi/CHANGELOG.md` v0.102** 有明确示例；后续字段（如 `upstream_timeout`、`cache_enabled` 等）在 **v0.107.64** 等条目追加——**以 CHANGELOG 为准**。

---

## 4）DNS 重写（rewrites）

| 操作 | 路径 | Method | Body / 响应 |
|------|------|--------|----------------|
| **列表** | `/control/rewrite/list` | `GET` | 成功：JSON **数组**，元素为 **`RewriteEntry`**。 |
| **新增** | `/control/rewrite/add` | `POST` | JSON：`RewriteEntry`。 |
| **删除** | `/control/rewrite/delete` | `POST` | JSON：`RewriteEntry`（用于定位）。 |
| **更新** | `/control/rewrite/update` | `PUT` | JSON：`RewriteUpdate`（含 `target` 与 `update` 两个 `RewriteEntry`）。 |
| **全局开关** | `/control/rewrite/settings` | `GET` | `{"enabled": true/false}` |
| | `/control/rewrite/settings/update` | `PUT` | 同上 |

**`RewriteEntry`（OpenAPI）要点**

- `domain`：域名。
- `answer`：A / AAAA / CNAME 记录值（字符串）。
- `enabled`（可选）：是否启用；新增时省略默认 `true`；更新时省略表示保留原值。

**`RewriteEntry` schema**：OpenAPI 中 **无 `required` 数组**（三字段均可按文档语义可选；以 yaml 为准）。

**版本线索**：`GET`/`PUT` `/control/rewrite/settings*` 与 rewrite 上 `enabled`：**CHANGELOG 记为 v0.107.68**；`PUT /control/rewrite/update` 见 CHANGELOG 单独条目。

**DNSFleet 对齐**：`GlobalConfig` 中 `Type=rewrite` 的 **`Content`** 须为 **与上述 REST 一致的 JSON 数组**（元素形状与字段名以 OpenAPI `RewriteEntry` 为准），不得自创第三种模型。

---

## 5）查询日志：分页 / 过滤（无官方流式 API）

| 路径 | Method | 查询参数 | 说明 |
|------|--------|-----------|------|
| `/control/querylog` | `GET` | `older_than`（string，时间游标）；`offset`（int）；`limit`（int）；`search`（string）；`response_status`（enum：`all`、`filtered`、`blocked`、`blocked_safebrowsing`、`blocked_parental`、`whitelisted`、`rewritten`、`safe_search`、`processed`） | 成功体 schema 为 **`QueryLog`**，仅有 `properties`：**`oldest`**、**`data`**（无顶层 `required` 数组；以 yaml 为准）。 |
| `/control/querylog/config` | `GET` | — | 响应 **`GetQueryLogConfigResponse`**：`required` 含 **`enabled`**、**`interval`**、**`anonymize_client_ip`**、**`ignored`**；另有可选 **`ignored_enabled`**（**CHANGELOG v0.107.72**：为 config / config/update 增加）。实现读取或 PUT 更新时须满足 **`ignored` 等必填**（与 OpenAPI 一致）。 |
| `/control/querylog/config/update` | `PUT` | JSON body | 同上，更新查询日志全局配置。 |
| `/control/querylog_clear` | `POST` | — | 清空查询日志。 |

**仍存在于 OpenAPI 但已弃用的旧 path**（主表不列；**勿**用于新代码）：`GET /control/querylog_info`、`POST /control/querylog_config` 等仍可能带 **`deprecated: true`**，由 **`querylog/config`** 系列替代——与 CHANGELOG **Deprecated** 叙述一致。

**流式 / WebSocket**：OpenAPI **未**提供 WebSocket/SSE 式「实时查询日志」端点；常见做法是 **`GET /control/querylog` 轮询**。社区有「实时 Query Log」诉求（例如 Issue #666），**不**改变官方当前契约。

**版本线索**：`offset`/`limit`：**v0.103** 起记入 CHANGELOG；`querylog/config` 系列替代旧 API 见 CHANGELOG **Deprecated** 说明。

**最低版本假设（示例：≥ v0.107.70）**：自 **v0.107.72** 向下至 **v0.107.70** 的 CHANGELOG 章节中 **未**见 **`BREAKING API CHANGES`** 标题；**v0.107.70** 为 `GET /control/status` 增加 `start_time`，**v0.107.72** 为 querylog config 增加 `ignored_enabled`，均为 **additive**。若仍兼容 **低于 0.107.70** 的实例，须自行查阅 **更早** CHANGELOG 中的 **BREAKING** 条目。

**DNSFleet Step 4**：后端对浏览器仍可提供 **DNSFleet 自己的 WebSocket** 聚合流；对每个 AdGH 节点侧应采用 **轮询**（或将来若官方增加流式再评估），并在产品层说明与「真 push」的差异。

---

## DNSFleet 与 `Node.AuthKind`（`basic` / `bearer`）

- **官方控制面契约（本文件 §1）**：标准发行版以 **HTTP Basic**（及可选 Cookie 会话）为主；**无** OpenAPI 级 `Bearer`。
- **DNSFleet 数据模型**（见本机 `docs/详细开发计划.md` §1.3）：`AuthKind` 为 `basic` | `bearer`，`Credential` 在 Basic 为密码、在 Bearer 为 token。
- **实现约束（v0.1）**：
  - **`basic`**：`internal/adguard` 客户端 **必须** 使用 **`Authorization: Basic`** 访问 `/control/*`（与 OpenAPI 一致）。
  - **`bearer`**：**不得**假造「官方 Bearer」语义；若目标实例为 **官方发行版** 且无前置代理，Step 2/3 应在保存或调用时返回 **明确错误** 或维护者在部署层统一改为 Basic。**OEM / 自建反代** 若存在类 Bearer 行为，须在 **部署说明** 中单写，**不**扩写进本文件以免与官方 OpenAPI 混淆。

---

## 变更策略

本文件随仓库版本控制。**在已定稿的里程碑内实现 Step 2–4 时，以本文件与引用的 OpenAPI/CHANGELOG 为准**；若 AdGH 上游变更 API，应 **先更新本文件与 CHANGELOG 引用**，再改 `internal/adguard` 等实现。
