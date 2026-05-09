package models

import (
	"strings"
	"time"
)

// Node 表示一台 AdGuard Home 节点（控制面 SQLite 持久化）。
// Online 对应 PRD / 详细开发计划中的节点在线状态（原表头 Status）；true=在线，false=离线；勿与 HTTP 状态码混淆。
type Node struct {
	ID        uint `gorm:"primaryKey;autoIncrement"`
	CreatedAt time.Time
	UpdatedAt time.Time

	Name     string `gorm:"not null"`
	BaseURL  string `gorm:"not null"` // 保存前可经 NormalizeBaseURL；缺 scheme 的拒绝在 Step 3。
	Username string // Basic 时用户名；Bearer 时可为空。

	// Credential：AuthKind 为 basic 时为密码，为 bearer 时为 token。
	// 明文落在控制面 SQLite 的风险见仓库根 AGENTS.md（本机，不推送）；须限制面板访问与备份。
	Credential string `gorm:"not null"`
	AuthKind   string `gorm:"type:text;not null"` // 取值 AuthKindBasic / AuthKindBearer。

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
