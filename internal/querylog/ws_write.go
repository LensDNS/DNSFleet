package querylog

import (
	"encoding/json"
	"fmt"

	"github.com/gorilla/websocket"

	"github.com/lensdns/dnsfleet/internal/config"
)

// systemMsg is Step 4 §4.E (type=system).
type systemMsg struct {
	Type     string `json:"type"`
	Event    string `json:"event"`
	Message  string `json:"message"`
	NodeID   uint   `json:"node_id,omitempty"`
	NodeName string `json:"node_name,omitempty"`
}

// writeWebSocketJSONObject marshals v as one JSON text frame; applies WsMaxFrameBytes cap (§4.G).
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
		fallback, ferr := json.Marshal(systemMsg{
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
