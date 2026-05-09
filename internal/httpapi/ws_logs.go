package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

// wsSystem is a Step 4 §4.E control message (type=system).
type wsSystem struct {
	Type     string `json:"type"`
	Event    string `json:"event"`
	Message  string `json:"message"`
	NodeID   uint   `json:"node_id,omitempty"`
	NodeName string `json:"node_name,omitempty"`
}

func writeWebSocketJSONObject(conn *websocket.Conn, maxBytes int, v any) error {
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
		if ferr != nil || len(fallback) > maxBytes {
			return nil
		}
		return conn.WriteMessage(websocket.TextMessage, fallback)
	}
	return conn.WriteMessage(websocket.TextMessage, b)
}

// wsLogs implements GET /api/v1/ws/logs (Step 4 §4.1): Upgrade, optional system connected, read loop until disconnect.
// Upstream querylog polling and type=log frames are Step 4 §4.2.
func (r *Routes) wsLogs(c echo.Context) error {
	// CheckOrigin true: dev-friendly; restrict origins in production (reverse proxy or env-driven) per Step 4 §4.G / README.
	up := websocket.Upgrader{
		CheckOrigin: func(*http.Request) bool { return true },
	}
	conn, err := up.Upgrade(c.Response().Writer, c.Request(), nil)
	if err != nil {
		return err
	}
	defer conn.Close()
	// v0.1 rejects application payloads from browser; cap inbound size to limit abuse (§4.1 read loop only).
	const wsMaxClientReadBytes = 4096
	conn.SetReadLimit(wsMaxClientReadBytes)

	connected := wsSystem{
		Type:    "system",
		Event:   "connected",
		Message: "query log stream ready (upstream polling in Step 4.2)",
	}
	if err := writeWebSocketJSONObject(conn, r.Deps.Config.WsMaxFrameBytes, connected); err != nil {
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
				_ = conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second))
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
