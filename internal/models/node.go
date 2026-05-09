package models

import (
	"strings"
	"time"
)

// Node 表示一台 AdGuard Home 节点（控制面 SQLite 持久化）。
// Online 对应 PRD / 详细开发计划中的节点在线状态（原表头 Status）；true=在线，false=离线；勿与 HTTP 状态码混淆。
// 校验口径（Basic 用户名非空、bearer 用户名可空、不支持零凭据节点等）见本机 docs/详细开发计划.md §1.3。
type Node struct {
	ID        uint `gorm:"primaryKey;autoIncrement"`
	CreatedAt time.Time
	UpdatedAt time.Time

	Name    string `gorm:"not null"`
	BaseURL string `gorm:"not null"` // 保存前可经 NormalizeBaseURL；缺 scheme 的拒绝在 Step 3。
	// Username：AuthKind=basic 时 Trim 后须非空；bearer 时可为空。详见 docs/详细开发计划.md §1.3。
	Username string

	// Credential：AuthKind 为 basic 时为密码，为 bearer 时为 token。v0.1 不支持免认证节点，须非空（§1.3）。
	// 明文落在控制面 SQLite 的风险见仓库根 AGENTS.md（本机，不推送）；须限制面板访问与备份。
	Credential string `gorm:"not null"`
	// AuthKind：仅 basic | bearer（§1.3）；取值常量见 auth_kind.go。
	AuthKind string `gorm:"type:text;not null"`

	Online bool `gorm:"default:false"` // 节点在线状态。

	Version    string `gorm:"default:''"`
	LastPingMs int64  `gorm:"default:0"` // 毫秒；未知为 0。
	LastSyncAt *time.Time
	Drifted    bool `gorm:"default:false"`
}

// NormalizeBaseURL 仅 TrimSpace 并去掉末尾的空白与 `/`，不补 scheme（缺 scheme 的校验在 Step 3）。
func NormalizeBaseURL(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "/ ")
	return s
}
