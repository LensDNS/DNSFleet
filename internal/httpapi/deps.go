package httpapi

import (
	"github.com/lensdns/dnsfleet/internal/config"
	"gorm.io/gorm"
)

// Deps carries shared dependencies for HTTP handlers and the drift loop.
type Deps struct {
	Config config.Config
	DB     *gorm.DB
	// AdGHSem limits concurrent outbound AdGuard Home HTTP calls (sync + drift share this channel).
	AdGHSem chan struct{}
}
