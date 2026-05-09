package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	fleetdb "github.com/lensdns/dnsfleet/internal/db"
	"github.com/lensdns/dnsfleet/internal/models"
	"github.com/lensdns/dnsfleet/internal/querylog"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newMockAdGuardQueryLog(t *testing.T, nodeLabel string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/control/querylog/config":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"enabled":             true,
				"interval":            1,
				"anonymize_client_ip": false,
				"ignored":             []any{},
			})
		case "/control/querylog":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"oldest": "2020-01-01T00:00:00.000000000Z",
				"data": []map[string]any{
					{"time": "2020-01-02T00:00:00.000000000Z", "question": map[string]any{"name": nodeLabel + ".example"}},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestWSLogsLiveQueryLogTwoNodes(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dbPath := t.TempDir() + "/int.db"
	db, err := fleetdb.OpenAndMigrate(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	defer func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	}()

	s1 := newMockAdGuardQueryLog(t, "n1")
	defer s1.Close()
	s2 := newMockAdGuardQueryLog(t, "n2")
	defer s2.Close()

	nodes := []models.Node{
		{Name: "alpha", BaseURL: s1.URL, Username: "u", Credential: "p", AuthKind: models.AuthKindBasic, Online: true},
		{Name: "beta", BaseURL: s2.URL, Username: "u", Credential: "p", AuthKind: models.AuthKindBasic, Online: true},
	}
	if err := db.Create(&nodes[0]).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&nodes[1]).Error; err != nil {
		t.Fatal(err)
	}

	cfg := baseCfg()
	cfg.QueryLogPollInterval = 200 * time.Millisecond
	cfg.AdminToken = "admintok"

	hub := querylog.NewHub(ctx, db, cfg)
	deps := Deps{
		Config:  cfg,
		DB:      db,
		AdGHSem: make(chan struct{}, cfg.SyncMaxConcurrent),
		Hub:     hub,
	}
	e := echo.New()
	Mount(e, deps)
	ts := httptest.NewServer(e)
	defer ts.Close()

	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/v1/ws/logs"
	hdr := http.Header{}
	hdr.Set("Authorization", "Bearer admintok")
	d := websocket.Dialer{}
	conn, _, err := d.Dial(u, hdr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	deadline := time.Now().Add(5 * time.Second)
	var sawLog bool
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		_, data, rerr := conn.ReadMessage()
		if rerr != nil {
			t.Fatalf("read: %v", rerr)
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		if typ, _ := m["type"].(string); typ == "log" {
			if _, ok := m["node_id"]; !ok {
				t.Fatalf("log missing node_id: %v", m)
			}
			if _, ok := m["node_name"]; !ok {
				t.Fatalf("log missing node_name: %v", m)
			}
			sawLog = true
			break
		}
	}
	if !sawLog {
		t.Fatal("expected at least one type=log frame")
	}
}
