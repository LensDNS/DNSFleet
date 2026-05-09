package httpapi

import (
	"github.com/gorilla/websocket"
	"github.com/lensdns/dnsfleet/internal/config"
	"gorm.io/gorm"
)

// LogHub receives WebSocket connections for live query log fan-out (Step 4 §4.2).
type LogHub interface {
	// Register sends the initial handshake on conn and starts the outbound pump; returns false if the handshake write failed (caller should close conn).
	Register(conn *websocket.Conn) bool
	Unregister(conn *websocket.Conn)
}

// Deps carries shared dependencies for HTTP handlers and the drift loop.
type Deps struct {
	Config config.Config
	DB     *gorm.DB
	// AdGHSem limits concurrent outbound AdGuard Home HTTP calls (sync + drift share this channel).
	AdGHSem chan struct{}
	// Hub aggregates upstream querylog polling; must be non-nil in production (cmd/dnsfleet).
	Hub LogHub
}
