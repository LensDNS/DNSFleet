package models

// 节点面板认证方式（与详细开发计划 §1.3 一致）。
// Bearer 与官方 OpenAPI 无 Bearer 的说明见 api/ADGUARD_HOME_CONTROL_API.md；模型仅存储，Step 2 处理拒绝/代理。
const (
	AuthKindBasic  = "basic"
	AuthKindBearer = "bearer"
)
