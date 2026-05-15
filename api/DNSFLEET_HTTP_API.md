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
| `POST` | `/api/v1/nodes/:id/probe` | 主动探测单节点（AdGH **`GET /control/status`** + **`GET /control/stats`**）；不要求节点在线；占 **`DNSFLEET_SYNC_MAX_CONCURRENT`**；详见下文 **「POST /nodes/:id/probe」** |
| `GET` | `/api/v1/nodes/:id/querylog` | 代理该节点 AdGH **`GET /control/querylog`**（深历史分页）；见下文 **「Query log 代理」** |
| `PATCH` | `/api/v1/nodes/:id` | 更新节点；成功 **200**；探测失败 **422**（规则同 POST） |
| `DELETE` | `/api/v1/nodes/:id` | 删除；成功 **204** 无 body；不存在 **404** |
| `GET` | `/api/v1/config/global` | 全局期望配置 |
| `PUT` | `/api/v1/config/global` | 写入/更新全局期望（upsert） |
| `POST` | `/api/v1/sync` | 将全局配置下发到节点 |

## 节点 JSON（请求/响应）

**写请求**（`POST` / `PATCH` body）字段与校验见 `internal/models` 与裁决 §1.3：`name`、`base_url`（须含 `http`/`https` 与 host）、`username`、`credential`、`auth_kind`（`basic` | `bearer`）。

**响应**（列表元素与详情）：含 `id`、`name`、`base_url`、`username`、`auth_kind`、`online`、`version`、`last_ping_ms`、`last_sync_at`（Unix 毫秒，可为 null）、`drifted`、`ui_url`（`NormalizeBaseURL(base_url)`）、`created_at` / `updated_at`（Unix 毫秒）。**永不**返回 `credential`。

**Runtime 快照（AdGH `GET /control/stats`，v0.1.4）**：与 **`GET /control/status`** 在同一 **probe** 路径串行拉取；成功时另含 **`runtime_dns_queries`**、**`runtime_blocked`**（`num_blocked_filtering`）、**`runtime_block_ratio`**（`runtime_blocked/runtime_dns_queries`，仅当 `runtime_dns_queries > 0`，否则 JSON **`null`**）、**`runtime_avg_processing_ms`**（`avg_processing_time`×1000 四舍五入）、**`runtime_stats_at`**（本次读取的 Unix 毫秒）。**任一步失败或节点离线**时上述字段均为 **`null`**（不保留过期快照冒充新读数）。**不是** DNSFleet 历史或 Hub 累计。

**422** 响应：`{"message":"<单句说明>","node":{...}}`，其中 `node` 为上述形状摘要（仍无 `credential`）。

### 鉴权与错误的区分（Admin vs 上游）

- **401**：仅 **Admin** token 缺失、错误或校验失败（Echo Admin 中间件），与其它 `/api/v1` 一致。
- **422**（节点写请求或 **`POST .../probe`** 探测失败）：已进入 handler；多为 **AdGH / 凭据 / 网络** 导致的 **`probe` 失败**，响应体含 **`message`**；**不要**与面板登录过期混淆。

## POST /api/v1/nodes/:id/probe

- **用途**：对**已存在**节点执行一次 AdGH **`GET /control/status`** 与 **`GET /control/stats`**（串行），并刷新库中 `online`、`version`、`last_ping_ms` 及 **runtime 统计快照**字段（见上文「Runtime 快照」）。
- **不要求**节点当前 **`online=true`**（用于误判离线后的自愈）。
- **`id` 非法** → **400**；**节点不存在** → **404**（404 **先于**占用并发槽，不打 AdGH）。
- **成功** → **200**，响应体为节点 JSON（与 **`GET /api/v1/nodes/:id`** 相同形状）。
- **探测失败** → **422**，`{"message":"<说明>","node":{...}}`（与 **`POST`/`PATCH` `/nodes`** 探测失败口径一致）。
- **并发**：本路由在 handler 内占用 **`DNSFLEET_SYNC_MAX_CONCURRENT`**（与 **漂移**、**`POST /sync`**、**`GET .../querylog`** 共用同一 semaphore）。**`status` 与 `stats` 各占一次出站请求**，仍串行于同一 handler 内。**注意**：**`POST`/`PATCH` `/api/v1/nodes`** 创建/更新节点时内部的首次探测 **当前不经**该 semaphore；运维估算「出站 AdGH 峰值」时应把 **专用 probe 路由**与 **写节点时的探测** **相加**考虑，勿写成「所有 probe 都占槽」。
- **503**：在等待 semaphore 槽位期间，若**请求上下文**结束（超时、客户端断开等），返回 **503**，`{"message":"<...>"}`（常为 `context canceled` 类文案）。实现为 **阻塞等待**直至取得槽或上下文取消，**不是**「槽满瞬时拒绝」。

## POST /api/v1/nodes/:id/mark-offline

- **用途**：将节点 **`online` 置为 `false`**，**不**调用 AdGH（由控制面或 UI 在重复 querylog 拉取失败等场景主动标记）。
- **`id` 非法** → **400**；**节点不存在** → **404**。
- **成功** → **200**，响应体为节点 JSON（与 **`GET /api/v1/nodes/:id`** 相同形状）。
- **并发**：**不**占用 `DNSFLEET_SYNC_MAX_CONCURRENT`（仅写 SQLite）。

Hub 侧 querylog 轮询对同一节点 **连续 3 次**拉取失败时也会调用同一 `nodeoffline.Mark` 逻辑；Live Logs 首屏/翻页 REST 失败由前端计数 **3 次** 后调用本路由，与 Hub 阈值对齐。

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

`results` 按 `node_id` 升序排列。仅 **`ok=true`** 的节点会更新 `LastSyncAt`，并依次 **re-probe**（`status`+`stats`）与 **漂移复检**（`GET /control/dns_info` + `rewrite/list`，与后台 drift loop 同逻辑），据此写入 `Drifted`（一致则为 `false`，仍不一致则为 `true`）。

对 AdGH 的调用在整次请求的总超时（`DNSFLEET_SYNC_TOTAL_TIMEOUT`）内执行；对超时类错误有有限次重试（指数退避）。

## 并发：漂移与同步

进程内 **漂移检测**、**`POST /sync`**、**`GET /api/v1/nodes/:id/querylog`** 与 **`POST /api/v1/nodes/:id/probe`** **共用**同一个 semaphore，上限为 `DNSFLEET_SYNC_MAX_CONCURRENT`（默认 **8**），即任意时刻经该槽位发往 AdGH 的飞行中请求总数不超过该值（含浏览器拉取历史 querylog、专用 probe）。**503** 语义见上文 **「POST /nodes/:id/probe」**：多在等待槽位时请求上下文结束，而非瞬时拒答。详见根目录 `README.md`「Configuration」。

## WebSocket：`GET /api/v1/ws/logs`

- **协议**：客户端发起 **`GET /api/v1/ws/logs`**，完成 WebSocket Upgrade；服务端向下游推送 **JSON 文本帧**。**应用层钉死**：**每个文本帧 payload = 恰好一条 JSON（单行）** ↔ 浏览器每个 `message` 事件 **`JSON.parse` 一次**；**禁止**单帧多条 JSON。非浏览器客户端按同一约定解析。**无**自定义 **`Sec-WebSocket-Protocol`**（v0.1）。
- **鉴权**：见上文「WebSocket Upgrade 的凭据」。
- **多连接**：进程内 **一套** 上游 querylog 聚合；向 **每个** 已连接客户端 **fan-out** 同一事件序列；**无任何**下游连接时 **停止** 对 AdGH 的 querylog 轮询（见详细计划 §4.D）。
- **客户端上行**：v0.1 **无**应用层 JSON（无订阅/过滤指令）；仅协议级 Ping/Pong/Close。
- **消息**：每条为 JSON 对象；顶层字段 **`type`** 取值 **`"log"`** 或 **`"system"`**：
  - **`"type":"log"`**：一行查询日志；另含 **`node_id`**、**`node_name`**（展示名为 **推送时**自 DB 读的**快照**；控制面改名后 **不保证**长连接上后续消息热更新，**直至重连**）、**`entry`**（对象：AdGH `GET /control/querylog` 返回条目的字段映射，见本机 `docs/详细开发计划.md` Step 4「字段映射摘录」或与 OpenAPI 对齐的仓库摘录表）。**可选 `fingerprint`**：为该 `entry` 原始 JSON 字节的 **SHA-256 十六进制**，与 Hub 进程内去重键一致；省略时由 UI 自行派生合并键。
    - **`fingerprint` 与 Live Logs REST 去重**：浏览器对 **`GET /api/v1/nodes/:id/querylog`** 返回的条目在无稳定 id 时，用 **`SHA-256(node_id + JSON.stringify(entry))`** 由 **已解析对象**再序列化派生键；字节序列与 Hub 对 **原始 JSON 字节** 的摘要 **一般不等价**。同一逻辑事件在 WS（有 `fingerprint`）与 REST 两线并进时 **通常**仍可对齐；若仅一侧有指纹或两侧序列化不一致，UI 在极少数情况下可能出现 **两行**（仅合并视角），属已知取舍。需要强一行语义时，应 **保证 Hub 下发 `fingerprint`** 并在未来如 REST 增补与之一致的稳定 id 后再收紧（超出当前 v0.1 时单独立项）。
  - **`"type":"system"`**：控制面事件；含 **`event`**（稳定字符串；**当前 Hub 会发送的**例如 `connected`、`upstream_error`、`querylog_disabled`、`backpressure_drop`、`frame_too_large`）、**`message`**（单句人可读说明，**不得**含凭据）、可选 **`node_id`** / **`node_name`**（**`node_name`** 语义同 **`log`**，快照）。**`connected`**：当前实现由 **`internal/querylog` Hub** 在 WebSocket **`Register`** 后 **同步**下发一条（便于区分「空日志」与「尚未推送」）。**说明**：`node_up` / `node_down` / `upstream_warn` 等名称可在文档或其它组件中预留，**当前 `internal/querylog` Hub 不发送**上述预留类 `system` 帧；请勿按已上线能力依赖它们。
- **排序**：v0.1 **FIFO**：按各节点轮询结果到达顺序推送 **`log`**；**不保证**跨节点严格时间全序。**Live Logs 页面**以 **`GET /nodes/:id/querylog`** 首屏与滚底分页为主、WS 为增量；UI 合并列表以 `entry.time` 为主序，**约 1.5s 内**相邻行可能按到达先后微调（非金融全序）。
- **背压**：**默认**（钉死）：每客户端发送队列 **有界**，满则 **丢弃该客户端最旧积压** 并发送 **`system` + `backpressure_drop`**；**不断开**连接（见详细计划 §4.G）。**实现备注**：向已满队列塞入新帧时，可能对 **该连接** 在 **不持有** Hub 全局 `broadcast` 锁的前提下 **循环丢队头直至能装入**（单连接上的尾部延迟放大；非死锁）。若将来要 SLO，可观测单次入队耗时或限步数。
- **Warm 回放（实现备注）**：新订阅建立时 Hub 可能向该连接回放 **进程内全局有界** 的最近若干条 **`log`**（条数与单帧上限受配置约束），**不是**「每节点完整 tail」；**重连 ≠ 恢复每节点完整历史**（深历史仍靠 REST `GET .../querylog`）。
- **传输**：建议启用 **Ping/Pong** 或框架等价 keepalive；单帧大小上限见环境变量 **`DNSFLEET_WS_MAX_FRAME_BYTES`**（根 `README`）。URL **`wss`/`ws`** 与站点 **`https`/`http`** 对齐。**Origin**：当前实现中 Upgrade 的 **`CheckOrigin` 为恒允许**（开发友好）；生产若对浏览器暴露本路由，须 **同源 / 反代限制 Origin** 或后续在代码收紧，与鉴权一节中 Query `token=` 风险一并评估。

实现细节、轮询参数与 AdGH 并发上限见 **Step 4 产品/协议裁决**（`docs/详细开发计划.md`）。

## 并发：Query Log 轮询（Step 4）

进程内 Hub 对 AdGH **`GET /control/querylog`** 的轮询使用 **独立** semaphore，上限 **`DNSFLEET_QUERYLOG_MAX_CONCURRENT`**（默认见 `README`），**不与** `DNSFLEET_SYNC_MAX_CONCURRENT` 混用。

**峰值心智**：任意时刻对 AdGH 的飞行请求数 **至多**约为「**漂移 + sync + REST querylog 代理**」槽位占用 +「**Hub querylog 轮询**」槽位占用（**两路相加**；实际依赖调度）。多标签页或频繁滚底拉历史时，REST 代理与 Hub 可能同时占满各自上限。

## Query log 代理：`GET /api/v1/nodes/:id/querylog`

- **鉴权**：与其它 `/api/v1` 路由相同（Admin）。
- **节点**：`id` 非法 → **400**；不存在 → **404**（与 `GET /nodes/:id` 一致）。**`online=false`** → **422**，`{"message":"node is offline"}`（不对离线节点无意义打 AdGH）。
- **Query 参数**（透传至 AdGH，语义见 [`ADGUARD_HOME_CONTROL_API.md`](./ADGUARD_HOME_CONTROL_API.md) §5）：
  - **`older_than`**：可选；**首屏须省略**该键（勿发空值 `older_than=`）；下一页用上一响应 JSON 的 **`oldest`** 填入。
  - **`offset`**：**仅支持 `0`**（缺省为 0）；非 0 → **400**（避免与游标分页混用）。
  - **`limit`**：缺省 **20**，服务端钳制 **1–100**。
  - **`response_status`**、**`search`**：可选；**须原样传入**上游 `GetQueryLog`（空 `search` 不在上游 URL 中带 `search`）。
- **成功**：**200**，JSON 与 AdGH **`QueryLog`** 一致：`{"oldest":"<游标>","data":[...]}`（`data` 元素为原始条目对象）。
- **上游失败**（网络、非 2xx、JSON 解码失败等）：**502**，`{"message":"<单句说明>"}`（与 **控制面 Admin 401** 区分）。
- **并发**：本路由占用 **`DNSFLEET_SYNC_MAX_CONCURRENT`** 与 drift/sync **同一** `AdGHSem`（见上文「并发：漂移与同步」）。

## 钉死：`rewrite` 类型

- **`GET`** / **`PUT`** 的 `rewrite` 均为 JSON 数组；空期望为 `[]`。

（上文已展开，本节保留为与历史裁决对齐的标题锚点。）
