# DNSFleet 控制面 HTTP API（v0.1）

行为以维护者本机 `docs/详细开发计划.md` 中 **「Step 3 产品/协议裁决」**、**「Step 4 产品/协议裁决」** 为最高优先级；与本文件冲突时以该裁决为准。

## 鉴权（`/api/v1`）

- **`GET /healthz`**：不经 Admin，无鉴权。
- **`/api/v1` 下全部路由**（含 **`/api/v1/ws/*` 的 WebSocket Upgrade**，见下文）：默认需 Admin（除非进程以 `DNSFLEET_ADMIN_INSECURE_DISABLE=1` 启动，此时跳过校验）。
- 校验方式（二选一，**Bearer 优先**）：
  - `Authorization: Bearer <DNSFLEET_ADMIN_TOKEN>`
  - `X-Admin-Token: <DNSFLEET_ADMIN_TOKEN>`
- 若 **同时** 提供 `Authorization: Bearer …` 与 `X-Admin-Token`，且两者 token **不一致** → **400**，JSON `{"message":"..."}`。
- 缺失或与配置不符 → **401**，JSON `{"message":"unauthorized"}`。

### WebSocket Upgrade 的凭据（钉死）

浏览器原生 WebSocket **无法**可靠设置任意 Header 时，允许 **Query** 传递与 Admin 同源的密钥：**`token=<DNSFLEET_ADMIN_TOKEN>`**（Token 出现在 URL 查询串：**勿**写入书签；警惕 Referrer、反向代理 access log、浏览器历史——等同泄漏 Admin 密钥）。**Query `token` 极易进入代理 access log**，生产优先 **Header** 或 **反代注入**，勿依赖查询串。

- **校验顺序**：若请求上 **同时** 存在「Header 方式给出的 token」与 Query **`token`**，且二者 **不一致** → **400**（与 REST 双 Header 不一致语义对齐）；若仅存在一种，则与该种比对配置。
- **缺凭据**：**未**启用 **`DNSFLEET_ADMIN_INSECURE_DISABLE=1`** 且 Header / Query **均未**给出有效 token → **401**（与 REST「缺失或与配置不符」一致）。
- **失败语义**：**在 Upgrade 完成之前**返回 **401**（或 **400** 用于「参数冲突」）；**不要**先 `101 Switching Protocols` 再发 JSON 错误（除非框架无法在 Upgrade 前拦截——实现须在 Echo 侧保证「先鉴权再 Upgrade」）。Upgrade **拒绝时响应体**可与 REST 的 JSON **`401`** 不一致（常见为空或非 JSON）。
- **部署**：生产环境 **推荐** 由反向代理校验会话 Cookie 或 **注入** `Authorization` / `X-Admin-Token`，避免 Query 进 access log；此为 **可选运维路径**，不改变 v0.1 默认「Header **或** Query `token`」的产品契约。
- **`DNSFLEET_ADMIN_INSECURE_DISABLE=1`**：与本节开篇一致，**WebSocket 同样跳过** Admin（仅开发）。

## 路径一览

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/healthz` | 健康检查，文本 `ok` |
| `GET` | `/api/v1/ws/logs` | WebSocket：**聚合查询日志**（Upgrade）；鉴权见上节 |
| `GET` | `/api/v1/nodes` | 节点列表 |
| `POST` | `/api/v1/nodes` | 创建节点；先落库再探测；成功 **201** 且 `online=true`；探测失败 **422** 且已落库 `online=false`（禁止 201 与 `online=false` 同现） |
| `GET` | `/api/v1/nodes/:id` | 节点详情；`id` 非正整数 **400**；不存在 **404** |
| `PATCH` | `/api/v1/nodes/:id` | 更新节点；成功 **200**；探测失败 **422**（规则同 POST） |
| `DELETE` | `/api/v1/nodes/:id` | 删除；成功 **204** 无 body；不存在 **404** |
| `GET` | `/api/v1/config/global` | 全局期望配置 |
| `PUT` | `/api/v1/config/global` | 写入/更新全局期望（upsert） |
| `POST` | `/api/v1/sync` | 将全局配置下发到节点 |

## 节点 JSON（请求/响应）

**写请求**（`POST` / `PATCH` body）字段与校验见 `internal/models` 与裁决 §1.3：`name`、`base_url`（须含 `http`/`https` 与 host）、`username`、`credential`、`auth_kind`（`basic` | `bearer`）。

**响应**（列表元素与详情）：含 `id`、`name`、`base_url`、`username`、`auth_kind`、`online`、`version`、`last_ping_ms`、`last_sync_at`（Unix 毫秒，可为 null）、`drifted`、`ui_url`（`NormalizeBaseURL(base_url)`）、`created_at` / `updated_at`（Unix 毫秒）。**永不**返回 `credential`。

**422** 响应：`{"message":"<单句说明>","node":{...}}`，其中 `node` 为上述形状摘要（仍无 `credential`）。

## `GET` / `PUT` `/api/v1/config/global`

- **`GET`**：若库中尚无行，仍 **200**，固定形状：`upstream` 为 `""`，`rewrite` 为 JSON **数组** `[]`（不是 DB `Content` 原始字符串）。
- **`PUT`** body：`{"upstream":"<多行文本>","rewrite":[...]}`。`rewrite` 为 JSON 数组（元素形状见 [`ADGUARD_HOME_CONTROL_API.md`](./ADGUARD_HOME_CONTROL_API.md) 第 4 节）。整段非法 JSON → **400**；语义错误 → **400** + `message`。省略 `rewrite` 或空值时按 `[]` 处理。成功后再 `GET` 等价返回。

SQLite 中 `GlobalConfig.Content` 仍为 JSON 文本持久化；HTTP 层负责序列化/反序列化。

## POST /api/v1/sync

- **鉴权**：同上。
- **请求体**：JSON。仅空白或空 body 视为 **`{}`**。
- **`node_ids`**：
  - **省略**或 JSON **`null`**：对所有 **`online=true`** 的节点执行同步；若无在线节点，仍 **200**，`selection` 为 `all_online`，`results` 可为空数组。
  - **`[]`**：**200**，不对任何节点调用 AdGH；`selection` 为 `empty_list`。
  - **非空数组**：仅同步列出的 id；若有 id 在库中不存在 → **400**，`{"message":"unknown node ids","unknown_ids":[...]}`。
- **响应**（**200**）：

```json
{
  "results": [
    { "node_id": 1, "ok": true },
    { "node_id": 2, "ok": false, "error": "..." }
  ],
  "selection": "all_online | listed | empty_list"
}
```

`results` 按 `node_id` 升序排列。仅 **`ok=true`** 的节点会更新 `LastSyncAt`；**不**清除 `Drifted`。

对 AdGH 的调用在整次请求的总超时（`DNSFLEET_SYNC_TOTAL_TIMEOUT`）内执行；对超时类错误有有限次重试（指数退避）。

## 并发：漂移与同步

进程内 **漂移检测** 与 **`POST /sync`** **共用**一个 semaphore，上限为 `DNSFLEET_SYNC_MAX_CONCURRENT`（默认 **8**），即任意时刻对 AdGH 的飞行中请求总数不超过该值。详见根目录 `README.md`「Configuration」。

## WebSocket：`GET /api/v1/ws/logs`

- **协议**：客户端发起 **`GET /api/v1/ws/logs`**，完成 WebSocket Upgrade；服务端向下游推送 **JSON 文本帧**。**应用层钉死**：**每个文本帧 payload = 恰好一条 JSON（单行）** ↔ 浏览器每个 `message` 事件 **`JSON.parse` 一次**；**禁止**单帧多条 JSON。非浏览器客户端按同一约定解析。**无**自定义 **`Sec-WebSocket-Protocol`**（v0.1）。
- **鉴权**：见上文「WebSocket Upgrade 的凭据」。
- **多连接**：进程内 **一套** 上游 querylog 聚合；向 **每个** 已连接客户端 **fan-out** 同一事件序列；**无任何**下游连接时 **停止** 对 AdGH 的 querylog 轮询（见详细计划 §4.D）。
- **客户端上行**：v0.1 **无**应用层 JSON（无订阅/过滤指令）；仅协议级 Ping/Pong/Close。
- **消息**：每条为 JSON 对象；顶层字段 **`type`** 取值 **`"log"`** 或 **`"system"`**：
  - **`"type":"log"`**：一行查询日志；另含 **`node_id`**、**`node_name`**（展示名为 **推送时**自 DB 读的**快照**；控制面改名后 **不保证**长连接上后续消息热更新，**直至重连**）、**`entry`**（对象：AdGH `GET /control/querylog` 返回条目的字段映射，见本机 `docs/详细开发计划.md` Step 4「字段映射摘录」或与 OpenAPI 对齐的仓库摘录表）。
  - **`"type":"system"`**：控制面事件；含 **`event`**（稳定字符串，例如 `connected`、`node_up`、`node_down`、`upstream_error`、`upstream_warn`、`querylog_disabled`、`backpressure_drop`、`frame_too_large`）、**`message`**（单句人可读说明，**不得**含凭据）、可选 **`node_id`** / **`node_name`**（**`node_name`** 语义同 **`log`**，快照）。其中 **`connected`** 可在握手成功后发一次（可选；省略时须在实现/README 说明）。
- **排序**：v0.1 **FIFO**：按各节点轮询结果到达顺序推送 **`log`**；**不保证**跨节点严格时间全序（终端 UI 可按 `entry` 内时间字段自行排序）。
- **背压**：**默认**（钉死）：每客户端发送队列 **有界**，满则 **丢弃该客户端最旧积压** 并发送 **`system` + `backpressure_drop`**；**不断开**连接（见详细计划 §4.G）。
- **传输**：建议启用 **Ping/Pong** 或框架等价 keepalive；单帧大小上限见环境变量 **`DNSFLEET_WS_MAX_FRAME_BYTES`**（根 `README`）。URL **`wss`/`ws`** 与站点 **`https`/`http`** 对齐。

实现细节、轮询参数与 AdGH 并发上限见 **Step 4 产品/协议裁决**（`docs/详细开发计划.md`）。

## 并发：Query Log 轮询（Step 4）

**不与** `DNSFLEET_SYNC_MAX_CONCURRENT` 共用 semaphore。Query log 使用独立上限 **`DNSFLEET_QUERYLOG_MAX_CONCURRENT`**（默认见 `README`）。  
**峰值心智**：任意时刻对 AdGH 的飞行请求数 **至多**约为「漂移/sync 槽位占用」+「querylog 槽位占用」（二者相加；实际依赖调度）。

## 钉死：`rewrite` 类型

- **`GET`** / **`PUT`** 的 `rewrite` 均为 JSON 数组；空期望为 `[]`。

（上文已展开，本节保留为与历史裁决对齐的标题锚点。）
