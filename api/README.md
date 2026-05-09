# api

| 文件 | 说明 |
|------|------|
| [`ADGUARD_HOME_CONTROL_API.md`](./ADGUARD_HOME_CONTROL_API.md) | **v0.1 权威**：AdGuard Home 控制面 HTTP API（认证、status、dns、rewrite、querylog）及 DNSFleet 与 `Node.AuthKind` 的对齐约束；实现 Step 2–4 前必读。 |
| [`DNSFLEET_HTTP_API.md`](./DNSFLEET_HTTP_API.md) | DNSFleet 自身 HTTP：**`/api/v1` REST**（Admin、节点、全局配置、同步）与 **`GET /api/v1/ws/logs` WebSocket**（Step 4）；裁决见本机 `docs/详细开发计划.md` Step 3 / Step 4。 |

其它：将来可在此放置 DNSFleet 自身的 OpenAPI（`openapi.yaml`）或对外 DTO 说明。
