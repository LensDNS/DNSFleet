package httpapi

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
)

// probeAndPersist runs GET /control/status then GET /control/stats (adguard.Client) and updates the node row.
// On status failure sets Online=false and clears runtime stats; returns err.
// If status succeeds but stats fails, node stays online with stats fields cleared (no stale snapshot).
// Drift detection (drift.go) does not call these; it uses GetDNSConfig + ListRewrites.
func probeAndPersist(ctx context.Context, db *gorm.DB, id uint) error {
	var n models.Node
	if err := db.WithContext(ctx).First(&n, id).Error; err != nil {
		return err
	}
	cl, err := adguardClientFor(&n)
	if err != nil {
		_ = clearProbeFields(ctx, db, id, false)
		return err
	}
	t0 := time.Now()
	st, err := cl.GetStatus(ctx)
	ping := time.Since(t0).Milliseconds()
	if err != nil {
		_ = clearProbeFields(ctx, db, id, false)
		return fmt.Errorf("probe: %w", err)
	}
	ver := st.Version

	stats, statsErr := cl.GetStats(ctx)
	if statsErr != nil {
		return db.WithContext(ctx).Model(&models.Node{}).Where("id = ?", id).Updates(map[string]any{
			"online":                    true,
			"version":                   ver,
			"last_ping_ms":              ping,
			"runtime_dns_queries":       nil,
			"runtime_blocked_filtering": nil,
			"runtime_avg_processing_ms": nil,
			"runtime_stats_at":          nil,
		}).Error
	}

	q := stats.NumDNSQueries
	b := stats.NumBlockedFiltering
	avgMs := int64(math.Round(stats.AvgProcessingTime * 1000))
	now := time.Now().UTC()
	return db.WithContext(ctx).Model(&models.Node{}).Where("id = ?", id).Updates(map[string]any{
		"online":                    true,
		"version":                   ver,
		"last_ping_ms":              ping,
		"runtime_dns_queries":       q,
		"runtime_blocked_filtering": b,
		"runtime_avg_processing_ms": avgMs,
		"runtime_stats_at":          now,
	}).Error
}

func clearProbeFields(ctx context.Context, db *gorm.DB, id uint, online bool) error {
	return db.WithContext(ctx).Model(&models.Node{}).Where("id = ?", id).Updates(map[string]any{
		"online":                    online,
		"version":                   "",
		"last_ping_ms":              int64(0),
		"runtime_dns_queries":       nil,
		"runtime_blocked_filtering": nil,
		"runtime_avg_processing_ms": nil,
		"runtime_stats_at":          nil,
	}).Error
}
