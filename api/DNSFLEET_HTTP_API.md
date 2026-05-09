# DNSFleet 控制面 HTTP API（v0.1）

行为以维护者本机 `docs/详细开发计划.md` 中 **「Step 3 产品/协议裁决」** 为最高优先级；与本文件冲突时以该裁决为准。

## 鉴权（`/api/v1`）

- **`GET /healthz`**：不经 Admin，无鉴权。
- **`/api/v1` 下全部路由**：默认需 Admin（除非进程以 `DNSFLEET_ADMIN_INSECURE_DISABLE=1` 启动，此时跳过校验）。
- 校验方式（二选一，**Bearer 优先**）：
  - `Authorization: Bearer <DNSFLEET_ADMIN_TOKEN>`
  - `X-Admin-Token: <DNSFLEET_ADMIN_TOKEN>`
- 若 **同时** 提供 `Authorization: Bearer …` 与 `X-Admin-Token`，且两者 token **不一致** → **400**，JSON `{"message":"..."}`。
- 缺失或与配置不符 → **401**，JSON `{"message":"unauthorized"}`。

## 路径一览

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/healthz` | 健康检查，文本 `ok` |
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

## 钉死：`rewrite` 类型

- **`GET`** / **`PUT`** 的 `rewrite` 均为 JSON 数组；空期望为 `[]`。

（上文已展开，本节保留为与历史裁决对齐的标题锚点。）
