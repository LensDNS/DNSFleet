package webui

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/lensdns/dnsfleet/internal/config"
	fleetdb "github.com/lensdns/dnsfleet/internal/db"
	"github.com/lensdns/dnsfleet/internal/httpapi"
)

// TestMount_afterHTTPAPI_unauthorizedNodesNotHTML guards route registration order:
// /api/v1 must stay API (JSON), never SPA HTML from webui.Mount.
func TestMount_afterHTTPAPI_unauthorizedNodesNotHTML(t *testing.T) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "webui-integration.db")
	db, err := fleetdb.OpenAndMigrate(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	}()
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})

	cfg := config.Config{
		AdminToken:            "admintok",
		AdminInsecureDisable:  false,
		SyncMaxConcurrent:     8,
		SyncTotalTimeout:      30 * time.Second,
		DriftInterval:         time.Hour,
		WsMaxFrameBytes:       config.DefaultWSMaxFrameBytes,
		QueryLogMaxConcurrent: 8,
		QueryLogPollInterval:  config.DefaultQueryLogPollInterval,
		QueryLogPageLimit:     config.DefaultQueryLogPageLimit,
	}

	e := echo.New()
	e.GET("/healthz", func(c echo.Context) error { return c.String(http.StatusOK, "ok") })
	httpapi.Mount(e, httpapi.Deps{
		Config:  cfg,
		DB:      db,
		AdGHSem: make(chan struct{}, cfg.SyncMaxConcurrent),
		Hub:     httpapi.ConnectedStubHub{MaxBytes: cfg.WsMaxFrameBytes},
	})
	Mount(e)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /api/v1/nodes = %d want 401 body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	lower := strings.ToLower(body)
	if strings.Contains(lower, "<!doctype") || strings.Contains(lower, "<html") {
		t.Fatalf("response looks like HTML: %.200q", body)
	}
	ct := rec.Header().Get("Content-Type")
	if strings.HasPrefix(strings.ToLower(ct), "text/html") {
		t.Fatalf("Content-Type is HTML: %q", ct)
	}
}
