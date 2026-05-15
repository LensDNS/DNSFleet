package nodeoffline

import (
	"context"

	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
)

// Mark sets the node offline and clears last probe / runtime snapshot fields.
// Used when repeated upstream observation fails (querylog hub, explicit API).
func Mark(ctx context.Context, db *gorm.DB, id uint) error {
	return db.WithContext(ctx).Model(&models.Node{}).Where("id = ?", id).Updates(map[string]any{
		"online":                    false,
		"version":                   "",
		"last_ping_ms":              int64(0),
		"runtime_dns_queries":       nil,
		"runtime_blocked_filtering": nil,
		"runtime_avg_processing_ms": nil,
		"runtime_stats_at":          nil,
	}).Error
}
