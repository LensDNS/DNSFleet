package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func wsBaseURL(ts *httptest.Server) string {
	return "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/v1/ws/logs"
}

func TestWSLogsUnauthorized(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	ts := httptest.NewServer(e)
	defer ts.Close()

	d := websocket.Dialer{}
	_, resp, err := d.Dial(wsBaseURL(ts), nil)
	if err == nil {
		t.Fatal("expected handshake failure")
	}
	if !errors.Is(err, websocket.ErrBadHandshake) {
		t.Fatalf("Dial: %v", err)
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		if resp != nil {
			t.Fatalf("want 401 got %d", resp.StatusCode)
		}
		t.Fatal("nil response")
	}
}

func TestWSLogsMismatchedBearerAndQuery(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	ts := httptest.NewServer(e)
	defer ts.Close()

	u := wsBaseURL(ts) + "?token=" + cfg.AdminToken
	hdr := http.Header{}
	hdr.Set("Authorization", "Bearer wrong")
	d := websocket.Dialer{}
	_, resp, err := d.Dial(u, hdr)
	if err == nil {
		t.Fatal("expected handshake failure")
	}
	if !errors.Is(err, websocket.ErrBadHandshake) {
		t.Fatalf("Dial: %v", err)
	}
	if resp == nil || resp.StatusCode != http.StatusBadRequest {
		if resp != nil {
			t.Fatalf("want 400 got %d", resp.StatusCode)
		}
		t.Fatal("nil response")
	}
}

func TestWSLogsMismatchedHeaders(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	ts := httptest.NewServer(e)
	defer ts.Close()

	hdr := http.Header{}
	hdr.Set("Authorization", "Bearer admintok")
	hdr.Set("X-Admin-Token", "other")
	d := websocket.Dialer{}
	_, resp, err := d.Dial(wsBaseURL(ts), hdr)
	if err == nil {
		t.Fatal("expected handshake failure")
	}
	if !errors.Is(err, websocket.ErrBadHandshake) {
		t.Fatalf("Dial: %v", err)
	}
	if resp == nil || resp.StatusCode != http.StatusBadRequest {
		if resp != nil {
			t.Fatalf("want 400 got %d", resp.StatusCode)
		}
		t.Fatal("nil response")
	}
}

func TestWSLogsOKBearer(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	ts := httptest.NewServer(e)
	defer ts.Close()

	hdr := http.Header{}
	hdr.Set("Authorization", "Bearer admintok")
	d := websocket.Dialer{}
	conn, resp, err := d.Dial(wsBaseURL(ts), hdr)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("want 101 path got %d", resp.StatusCode)
	}
	defer conn.Close()

	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var got wsSystem
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Type != "system" || got.Event != "connected" {
		t.Fatalf("got %+v", got)
	}
	_ = conn.Close()
}

func TestWSLogsOKQueryToken(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	ts := httptest.NewServer(e)
	defer ts.Close()

	u := wsBaseURL(ts) + "?token=" + cfg.AdminToken
	d := websocket.Dialer{}
	conn, _, err := d.Dial(u, nil)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var got wsSystem
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Type != "system" || got.Event != "connected" {
		t.Fatalf("got %+v", got)
	}
}

func TestRESTNodesUnauthorizedWithQueryTokenOnly(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes?token="+cfg.AdminToken, nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("REST must not accept query token; want 401 got %d", rec.Code)
	}
}
