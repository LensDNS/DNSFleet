package querylog

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/lensdns/dnsfleet/internal/config"
)

func TestTryEnqueue_backpressure_deliversNoticeAndPayload(t *testing.T) {
	h := &Hub{
		ctx: context.Background(),
		cfg: config.Config{WsMaxFrameBytes: config.DefaultWSMaxFrameBytes},
	}
	sub := &subscriber{
		out: make(chan []byte, 2),
	}
	sub.out <- []byte(`{"old":1}`)
	sub.out <- []byte(`{"old":2}`)
	if err := h.tryEnqueue(sub, []byte(`{"want":"payload"}`)); err != nil {
		t.Fatalf("tryEnqueue: %v", err)
	}
	var sawDrop, sawPayload bool
	// Queue ends as [backpressure_drop, payload]; older frames were dropped to make room.
	for range 2 {
		select {
		case b := <-sub.out:
			var m map[string]any
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if typ, _ := m["type"].(string); typ == "system" {
				if ev, _ := m["event"].(string); ev == "backpressure_drop" {
					sawDrop = true
				}
			}
			if v, ok := m["want"].(string); ok && v == "payload" {
				sawPayload = true
			}
		default:
			t.Fatal("expected 2 messages after backpressure path")
		}
	}
	if !sawDrop {
		t.Fatal("expected backpressure_drop system frame")
	}
	if !sawPayload {
		t.Fatal("expected original payload to be queued, not dropped after notice")
	}
}
