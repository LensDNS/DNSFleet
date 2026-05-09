package httpapi

import (
	"context"
	"sync"
	"time"

	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
)

// StartDriftLoop runs drift detection on a ticker until ctx is canceled.
// It performs one immediate run before entering the interval (see README).
func StartDriftLoop(ctx context.Context, deps Deps) {
	ticker := time.NewTicker(deps.Config.DriftInterval)
	defer ticker.Stop()
	runDriftOnce(ctx, deps)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runDriftOnce(ctx, deps)
		}
	}
}

func runDriftOnce(ctx context.Context, deps Deps) {
	if ctx.Err() != nil {
		return
	}
	upstream, expectedRew, err := loadGlobalUpstreamRewrite(ctx, deps.DB)
	if err != nil {
		return
	}
	var onlines []models.Node
	if err := deps.DB.WithContext(ctx).Where("online = ?", true).Order("id").Find(&onlines).Error; err != nil {
		return
	}
	var wg sync.WaitGroup
	for i := range onlines {
		n := onlines[i]
		wg.Add(1)
		go func(id uint) {
			defer wg.Done()
			driftOneNode(ctx, deps, id, upstream, expectedRew)
		}(n.ID)
	}
	wg.Wait()
}

func markNodeOfflineDrift(db *gorm.DB, ctx context.Context, id uint) {
	_ = db.WithContext(ctx).Model(&models.Node{}).Where("id = ?", id).Select("Online", "Version", "LastPingMs").Updates(&models.Node{
		Online:     false,
		Version:    "",
		LastPingMs: 0,
	}).Error
}

func driftOneNode(ctx context.Context, deps Deps, id uint, upstream string, expectedRew []byte) {
	if err := acquire(ctx, deps.AdGHSem); err != nil {
		return
	}
	defer release(deps.AdGHSem)

	var n models.Node
	if err := deps.DB.WithContext(ctx).First(&n, id).Error; err != nil {
		return
	}
	if !n.Online {
		return
	}
	cl, err := adguardClientFor(&n)
	if err != nil {
		markNodeOfflineDrift(deps.DB, ctx, id)
		return
	}
	cfg, err := cl.GetDNSConfig(ctx)
	if err != nil {
		markNodeOfflineDrift(deps.DB, ctx, id)
		return
	}
	rewrites, err := cl.ListRewrites(ctx)
	if err != nil {
		markNodeOfflineDrift(deps.DB, ctx, id)
		return
	}
	upOK := upstreamTextMatchesDNSConfig(upstream, cfg)
	rewOK, err := RewritesEqualFromLists(expectedRew, rewrites)
	if err != nil {
		rewOK = false
	}
	drifted := !(upOK && rewOK)
	_ = deps.DB.WithContext(ctx).Model(&models.Node{}).Where("id = ?", id).Select("Drifted", "Online").Updates(&models.Node{
		Drifted: drifted,
		Online:  true,
	}).Error
}
