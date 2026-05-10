# Query log → WebSocket `entry` 字段映射（摘录）

`GET /control/querylog` 响应 **`QueryLog`**：`oldest`（游标）与 **`data`**（数组）。数组元素 schema 以 **AdGuard Home 官方 OpenAPI** 为准（本仓库摘要见 [`api/ADGUARD_HOME_CONTROL_API.md`](../../api/ADGUARD_HOME_CONTROL_API.md) §5）。实现 Step 4 轮询与 `type=log` 的 **`entry`** 时，**逐字段对照 yaml**，下表仅为 UI/评审用 **常见键**（版本间可能有增减）。

| OpenAPI / JSON 字段（典型） | 含义（简述） | 建议进入 `entry` |
|------------------------------|--------------|-------------------|
| `time` | 查询时间（字符串，格式以 OpenAPI 为准） | 是 |
| `question` | 问题对象（含 `name`、`type`、`class` 等子字段） | 是 |
| `answer` | 解析结果（字符串或数组，以 yaml 为准） | 是 |
| `upstream` | 使用的上游标识 | 是 |
| `elapsedMs` | 解析耗时（毫秒） | 是 |
| `cached` | 是否命中缓存 | 是 |
| `client` | 客户端 IP / 标识 | 是 |
| `client_info` | 客户端附加信息（对象，可选） | 可选 |
| `reason` | 过滤/拦截原因码（数值或枚举，以 yaml 为准） | 是 |
| `rule` / `rules` | 命中规则名或规则列表（以 yaml 为准） | 是 |
| `filter_id` 等 | 其它诊断字段（若仍存在） | 可选 |

**约定**：`entry` 内尽量 **保留 AdGH 原始键名**（见 `docs/详细开发计划.md` Step 4 §4.E），便于与面板/OpenAPI 对齐；DNSFleet 不在此阶段发明平行字段名。

**Hub 尾包**：每轮询 tick、每在线节点 **仅一次** `GET /control/querylog`，**不传** `older_than`（最新一页，`limit` 见 `DNSFLEET_QUERYLOG_PAGE_LIMIT`）。**深历史**由浏览器调用控制面 **`GET /api/v1/nodes/:id/querylog`** 自行 `older_than` 分页（见 `api/DNSFLEET_HTTP_API.md`）。
