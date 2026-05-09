package models

import "time"

// GlobalConfig 存储全局下发配置片段（控制面 SQLite）。
//
// Type 取值 GlobalConfigTypeUpstream / GlobalConfigTypeRewrite。
//
// Content 语义：
//   - upstream：多行文本（上游 DNS 等）。
//   - rewrite：JSON 数组文本，元素对齐 OpenAPI RewriteEntry；详见 api/ADGUARD_HOME_CONTROL_API.md §4。
// 应用层不对 rewrite 做强 JSON Schema 校验（可选单测仅 smoke）。
type GlobalConfig struct {
	ID        uint `gorm:"primaryKey;autoIncrement"`
	CreatedAt time.Time
	UpdatedAt time.Time

	Type    string `gorm:"uniqueIndex:idx_global_config_type;not null"` // upstream | rewrite
	Content string `gorm:"type:text"`                                   // 见上
}
