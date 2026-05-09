package httpapi

import (
	"context"
	"fmt"
	"time"

	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
)

// probeAndPersist runs GetStatus and updates the node row. On failure sets Online=false and returns err.
func probeAndPersist(ctx context.Context, db *gorm.DB, id uint) error {
	var n models.Node
	if err := db.WithContext(ctx).First(&n, id).Error; err != nil {
		return err
	}
	cl, err := adguardClientFor(&n)
	if err != nil {
		_ = db.WithContext(ctx).Model(&models.Node{}).Where("id = ?", id).Select("Online", "Version", "LastPingMs").Updates(&models.Node{
			Online:     false,
			Version:    "",
			LastPingMs: 0,
		}).Error
		return err
	}
	t0 := time.Now()
	st, err := cl.GetStatus(ctx)
	ping := time.Since(t0).Milliseconds()
	if err != nil {
		_ = db.WithContext(ctx).Model(&models.Node{}).Where("id = ?", id).Select("Online", "Version", "LastPingMs").Updates(&models.Node{
			Online:     false,
			Version:    "",
			LastPingMs: 0,
		}).Error
		return fmt.Errorf("probe: %w", err)
	}
	ver := st.Version
	return db.WithContext(ctx).Model(&models.Node{}).Where("id = ?", id).Select("Online", "Version", "LastPingMs").Updates(&models.Node{
		Online:     true,
		Version:    ver,
		LastPingMs: ping,
	}).Error
}
