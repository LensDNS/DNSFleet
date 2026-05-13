package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"

	"github.com/lensdns/dnsfleet/internal/config"
)

// wsSystem is a Step 4 §4.E control message (type=system); used by tests and ConnectedStubHub.
type wsSystem struct {
	Type     string `json:"type"`
	Event    string `json:"event"`
	Message  string `json:"message"`
	NodeID   uint   `json:"node_id,omitempty"`
	NodeName string `json:"node_name,omitempty"`
}

func writeWebSocketJSONObject(conn *websocket.Conn, maxBytes int, v any) error {
	if conn == nil {
		return fmt.Errorf("writeWebSocketJSONObject: nil conn")
	}
	if maxBytes < 1 {
		maxBytes = config.DefaultWSMaxFrameBytes
	}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(b) > maxBytes {
		fallback, ferr := json.Marshal(wsSystem{
			Type:    "system",
			Event:   "frame_too_large",
			Message: "message exceeds DNSFLEET_WS_MAX_FRAME_BYTES",
		})
		if ferr != nil {
			return fmt.Errorf("writeWebSocketJSONObject: marshal fallback: %w", ferr)
		}
		if len(fallback) > maxBytes {
			return fmt.Errorf("writeWebSocketJSONObject: fallback still exceeds maxBytes")
		}
		return conn.WriteMessage(websocket.TextMessage, fallback)
	}
	return conn.WriteMessage(websocket.TextMessage, b)
}

// ConnectedStubHub implements LogHub for tests: sends system+connected on Register (production uses *querylog.Hub).
// It does not run writePump, warm replay, or tryEnqueue backpressure; regressions for those belong in
// `go test ./internal/querylog/...` against the real Hub (see hub_integration_test.go).
type ConnectedStubHub struct {
	MaxBytes int
}

// Register implements LogHub.
func (s ConnectedStubHub) Register(conn *websocket.Conn) bool {
	if conn == nil {
		return false
	}
	max := s.MaxBytes
	if max < 1 {
		max = config.DefaultWSMaxFrameBytes
	}
	err := writeWebSocketJSONObject(conn, max, wsSystem{
		Type:    "system",
		Event:   "connected",
		Message: "query log stream ready (stub hub)",
	})
	return err == nil
}

// Unregister implements LogHub.
func (ConnectedStubHub) Unregister(*websocket.Conn) {}

// wsLogs implements GET /api/v1/ws/logs (Step 4 §4.1–§4.2): Upgrade, Hub Register, read loop, Ping.
func (r *Routes) wsLogs(c echo.Context) error {
	if r.Deps.Hub == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "live log hub not configured")
	}
	// CheckOrigin true: dev-friendly; restrict origins in production (reverse proxy or env-driven) per Step 4 §4.G / README.
	up := websocket.Upgrader{
		CheckOrigin: func(*http.Request) bool { return true },
	}
	conn, err := up.Upgrade(c.Response().Writer, c.Request(), nil)
	if err != nil {
		return err
	}
	// Defer LIFO: Unregister runs before Close so the Hub stops writing before the socket closes (§4.2.1).
	defer conn.Close()
	defer func() { r.Deps.Hub.Unregister(conn) }()

	const wsMaxClientReadBytes = 4096
	conn.SetReadLimit(wsMaxClientReadBytes)

	if !r.Deps.Hub.Register(conn) {
		return nil
	}

	pongWait := 60 * time.Second
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	pingCtx, stopPing := context.WithCancel(context.Background())
	defer stopPing()
	go func() {
		tick := time.NewTicker(45 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-pingCtx.Done():
				return
			case <-tick.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second)); err != nil {
					// §4.2.1 / §4.G: unregister on WriteControl failure; close so ReadMessage unblocks.
					r.Deps.Hub.Unregister(conn)
					_ = conn.Close()
					return
				}
			}
		}
	}()

	for {
		_, _, rerr := conn.ReadMessage()
		if rerr != nil {
			break
		}
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	}
	return nil
}
