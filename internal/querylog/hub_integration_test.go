package querylog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/lensdns/dnsfleet/internal/config"
	fleetdb "github.com/lensdns/dnsfleet/internal/db"
	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "hub_test.db")
	db, err := fleetdb.OpenAndMigrate(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	t.Cleanup(func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	})
	return db
}

func integrationHubCfg() config.Config {
	return config.Config{
		WsMaxFrameBytes:       config.DefaultWSMaxFrameBytes,
		QueryLogMaxConcurrent: 8,
		QueryLogPollInterval:  120 * time.Millisecond,
		QueryLogPageLimit:     config.DefaultQueryLogPageLimit,
	}
}

func mockAdGuard(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv
}

func startHubWSServer(t *testing.T, hub *Hub) string {
	t.Helper()
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() {
			hub.Unregister(conn)
			_ = conn.Close()
		}()
		if !hub.Register(conn) {
			return
		}
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func dialWS(t *testing.T, httpURL string, hdr http.Header) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(httpURL, "http")
	d := websocket.Dialer{}
	conn, _, err := d.Dial(wsURL, hdr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	if m["type"] != "system" || m["event"] != "connected" {
		t.Fatalf("want connected frame, got %#v", m)
	}
	return conn
}

func readWSUntil(t *testing.T, conn *websocket.Conn, deadline time.Time, pred func(map[string]any) bool) bool {
	t.Helper()
	for time.Now().Before(deadline) {
		chunk := time.Until(deadline)
		if chunk > 400*time.Millisecond {
			chunk = 400 * time.Millisecond
		}
		if chunk < 1*time.Millisecond {
			break
		}
		_ = conn.SetReadDeadline(time.Now().Add(chunk))
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Logf("readWSUntil: read err: %v", err)
			return false
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("invalid json: %q", data)
		}
		if pred(m) {
			return true
		}
		t.Logf("skip frame: %s", data)
	}
	return false
}

func insertOnlineNode(t *testing.T, db *gorm.DB, name, baseURL string) models.Node {
	t.Helper()
	n := models.Node{
		Name:       name,
		BaseURL:    baseURL,
		Username:   "u",
		Credential: "p",
		AuthKind:   models.AuthKindBasic,
		Online:     true,
	}
	if err := db.Create(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

func queryLogConfigJSON(enabled bool) string {
	return fmt.Sprintf(`{"enabled":%t,"interval":1,"anonymize_client_ip":false}`, enabled)
}

func TestHub_querylog_disabled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	db := openTestDB(t)
	ad := mockAdGuard(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/control/querylog/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(queryLogConfigJSON(false)))
		default:
			http.NotFound(w, r)
		}
	})
	insertOnlineNode(t, db, "n1", ad.URL)

	cfg := integrationHubCfg()
	hub := NewHub(ctx, db, cfg)
	conn := dialWS(t, startHubWSServer(t, hub), nil)

	deadline := time.Now().Add(5 * time.Second)
	ok := readWSUntil(t, conn, deadline, func(m map[string]any) bool {
		return m["type"] == "system" && m["event"] == "querylog_disabled"
	})
	if !ok {
		t.Fatal("expected querylog_disabled system frame")
	}
}

func TestHub_upstream_error_500(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	db := openTestDB(t)
	ad := mockAdGuard(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/control/querylog/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(queryLogConfigJSON(true)))
		case "/control/querylog":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	})
	insertOnlineNode(t, db, "n1", ad.URL)

	cfg := integrationHubCfg()
	hub := NewHub(ctx, db, cfg)
	conn := dialWS(t, startHubWSServer(t, hub), nil)

	deadline := time.Now().Add(5 * time.Second)
	ok := readWSUntil(t, conn, deadline, func(m map[string]any) bool {
		msg, _ := m["message"].(string)
		return m["type"] == "system" && m["event"] == "upstream_error" && strings.Contains(msg, "HTTP 500")
	})
	if !ok {
		t.Fatal("expected upstream_error for HTTP 500")
	}
}

func TestHub_upstream_error_403(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	db := openTestDB(t)
	ad := mockAdGuard(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/control/querylog/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(queryLogConfigJSON(true)))
		case "/control/querylog":
			w.WriteHeader(http.StatusForbidden)
		default:
			http.NotFound(w, r)
		}
	})
	insertOnlineNode(t, db, "n1", ad.URL)

	cfg := integrationHubCfg()
	hub := NewHub(ctx, db, cfg)
	conn := dialWS(t, startHubWSServer(t, hub), nil)

	deadline := time.Now().Add(5 * time.Second)
	ok := readWSUntil(t, conn, deadline, func(m map[string]any) bool {
		msg, _ := m["message"].(string)
		return m["type"] == "system" && m["event"] == "upstream_error" && strings.Contains(msg, "403")
	})
	if !ok {
		t.Fatal("expected upstream_error for 403")
	}
}

func TestHub_upstream_error_401(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	db := openTestDB(t)
	ad := mockAdGuard(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/control/querylog/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(queryLogConfigJSON(true)))
		case "/control/querylog":
			w.WriteHeader(http.StatusUnauthorized)
		default:
			http.NotFound(w, r)
		}
	})
	insertOnlineNode(t, db, "n1", ad.URL)

	cfg := integrationHubCfg()
	hub := NewHub(ctx, db, cfg)
	conn := dialWS(t, startHubWSServer(t, hub), nil)

	deadline := time.Now().Add(5 * time.Second)
	ok := readWSUntil(t, conn, deadline, func(m map[string]any) bool {
		msg, _ := m["message"].(string)
		return m["type"] == "system" && m["event"] == "upstream_error" && msg == "upstream returned 401"
	})
	if !ok {
		t.Fatal("expected upstream_error with 401 branch message")
	}
}

func TestHub_multi_page_cursor(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	const pageLimit = 3 // mock first page len(data) must equal this (see handler below).

	db := openTestDB(t)
	var qlCalls atomic.Int32
	ad := mockAdGuard(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/control/querylog/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(queryLogConfigJSON(true)))
		case "/control/querylog":
			qlCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			if r.URL.Query().Get("older_than") == "" {
				// Full page (len(data)==pageLimit) + non-empty oldest → Hub fetches next page.
				_, _ = w.Write([]byte(`{"oldest":"cursor-next","data":[{"p":1},{"p":2},{"p":3}]}`))
				return
			}
			_, _ = w.Write([]byte(`{"oldest":"","data":[{"p":4}]}`))
		default:
			http.NotFound(w, r)
		}
	})
	insertOnlineNode(t, db, "n1", ad.URL)

	cfg := integrationHubCfg()
	cfg.QueryLogPageLimit = pageLimit
	hub := NewHub(ctx, db, cfg)
	conn := dialWS(t, startHubWSServer(t, hub), nil)

	deadline := time.Now().Add(6 * time.Second)
	ok := readWSUntil(t, conn, deadline, func(m map[string]any) bool {
		return m["type"] == "log"
	})
	if !ok {
		t.Fatal("expected at least one type=log frame")
	}
	// pollNode runs the second GET after the first page; the first log may be delivered before qlCalls reaches 2.
	for time.Now().Before(deadline) && qlCalls.Load() < 2 {
		time.Sleep(15 * time.Millisecond)
	}
	if n := qlCalls.Load(); n < 2 {
		t.Fatalf("expected at least 2 querylog calls, got %d", n)
	}
}

func TestHub_dedupe_same_response(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	db := openTestDB(t)
	ad := mockAdGuard(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/control/querylog/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(queryLogConfigJSON(true)))
		case "/control/querylog":
			w.Header().Set("Content-Type", "application/json")
			// Two byte-identical JSON objects (same literal twice).
			_, _ = w.Write([]byte(`{"oldest":"","data":[{"dup":true},{"dup":true}]}`))
		default:
			http.NotFound(w, r)
		}
	})
	insertOnlineNode(t, db, "n1", ad.URL)

	cfg := integrationHubCfg()
	hub := NewHub(ctx, db, cfg)
	conn := dialWS(t, startHubWSServer(t, hub), nil)

	deadline := time.Now().Add(4 * time.Second)
	logCount := 0
	for time.Now().Before(deadline) {
		chunk := time.Until(deadline)
		if chunk > 400*time.Millisecond {
			chunk = 400 * time.Millisecond
		}
		_ = conn.SetReadDeadline(time.Now().Add(chunk))
		_, data, err := conn.ReadMessage()
		if err != nil {
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				continue
			}
			break
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("invalid json: %q", data)
		}
		if m["type"] == "log" {
			logCount++
			if logCount > 1 {
				t.Fatalf("want exactly 1 log after dedupe, got another frame")
			}
			break
		}
	}
	if logCount != 1 {
		t.Fatalf("want exactly 1 type=log after dedupe, got %d", logCount)
	}
	// Avoid further reads: later hub/subscriber lifecycle may close the socket; gorilla can panic on reuse.
	time.Sleep(500 * time.Millisecond)
}

func TestHub_ctx_cancel_shutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	db := openTestDB(t)
	ad := mockAdGuard(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/control/querylog/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(queryLogConfigJSON(true)))
		case "/control/querylog":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"oldest":"","data":[]}`))
		default:
			http.NotFound(w, r)
		}
	})
	insertOnlineNode(t, db, "n1", ad.URL)

	cfg := integrationHubCfg()
	hub := NewHub(ctx, db, cfg)
	wsSrvURL := startHubWSServer(t, hub)
	conn := dialWS(t, wsSrvURL, nil)

	time.Sleep(300 * time.Millisecond)
	cancel()

	deadline := time.Now().Add(5 * time.Second)
	sawErr := false
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(350 * time.Millisecond))
		_, _, err := conn.ReadMessage()
		if err != nil {
			sawErr = true
			break
		}
	}
	if !sawErr {
		t.Fatal("expected ReadMessage error after hub ctx cancel (connection closed)")
	}
}
