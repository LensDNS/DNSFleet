package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/lensdns/dnsfleet/internal/config"
	fleetdb "github.com/lensdns/dnsfleet/internal/db"
	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func testDeps(t *testing.T, cfg config.Config) (*echo.Echo, *gorm.DB, func()) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := fleetdb.OpenAndMigrate(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	cleanup := func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	}
	e := echo.New()
	deps := Deps{
		Config:  cfg,
		DB:      db,
		AdGHSem: make(chan struct{}, cfg.SyncMaxConcurrent),
		Hub:     ConnectedStubHub{MaxBytes: cfg.WsMaxFrameBytes},
	}
	Mount(e, deps)
	return e, db, cleanup
}

func baseCfg() config.Config {
	return config.Config{
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
}

func TestAdminUnauthorized(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminMismatchedHeaders(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	req.Header.Set("X-Admin-Token", "other")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d", rec.Code)
	}
}

func TestAdminOK(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func adguardOKHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case strings.HasSuffix(p, "/control/status") && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"version": "v-mock"})
		case strings.HasSuffix(p, "/control/dns_info") && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"upstream_dns": []string{"1.1.1.1"}})
		case strings.HasSuffix(p, "/control/dns_config") && r.Method == http.MethodPost:
			w.WriteHeader(http.StatusOK)
		case strings.HasSuffix(p, "/control/rewrite/list") && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte("[]"))
		default:
			http.NotFound(w, r)
		}
	})
}

func TestPatchNodeSuccess(t *testing.T) {
	ag := httptest.NewServer(adguardOKHandler())
	defer ag.Close()

	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	create := map[string]any{
		"name": "before", "base_url": ag.URL, "username": "u", "credential": "p", "auth_kind": models.AuthKindBasic,
	}
	cb, _ := json.Marshal(create)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes", bytes.NewReader(cb))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201 got %d %s", rec.Code, rec.Body.String())
	}
	var created nodeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	patch := map[string]any{
		"name": "after", "base_url": ag.URL, "username": "u", "credential": "p", "auth_kind": models.AuthKindBasic,
	}
	pb, _ := json.Marshal(patch)
	preq := httptest.NewRequest(http.MethodPatch, "/api/v1/nodes/"+strconv.FormatUint(uint64(created.ID), 10), bytes.NewReader(pb))
	preq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	preq.Header.Set("Authorization", "Bearer admintok")
	prec := httptest.NewRecorder()
	e.ServeHTTP(prec, preq)
	if prec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d %s", prec.Code, prec.Body.String())
	}
	var out nodeResponse
	if err := json.Unmarshal(prec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Name != "after" || !out.Online {
		t.Fatalf("unexpected %+v", out)
	}
}

func TestPostNodeSuccess(t *testing.T) {
	ag := httptest.NewServer(adguardOKHandler())
	defer ag.Close()

	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	body := map[string]any{
		"name": "n1", "base_url": ag.URL, "username": "u", "credential": "p", "auth_kind": models.AuthKindBasic,
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201 got %d %s", rec.Code, rec.Body.String())
	}
	var out nodeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !out.Online || out.Version != "v-mock" {
		t.Fatalf("unexpected node %+v", out)
	}
}

func TestPostNodeProbeFails422(t *testing.T) {
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/control/status") {
			http.Error(w, "no", http.StatusServiceUnavailable)
			return
		}
		http.NotFound(w, r)
	}))
	defer bad.Close()

	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	body := map[string]any{
		"name": "n2", "base_url": bad.URL, "username": "u", "credential": "p", "auth_kind": models.AuthKindBasic,
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 got %d %s", rec.Code, rec.Body.String())
	}
	var payload map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &payload)
	node, _ := payload["node"].(map[string]any)
	if node["online"] != false {
		t.Fatalf("want online false in payload got %#v", payload)
	}
}

func TestSyncUnknownIDs(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync", strings.NewReader(`{"node_ids":[999]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d %s", rec.Code, rec.Body.String())
	}
}

func TestSyncEmptySelection(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync", strings.NewReader(`{"node_ids":[]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d %s", rec.Code, rec.Body.String())
	}
	var resp syncResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Selection != "empty_list" || len(resp.Results) != 0 {
		t.Fatalf("unexpected %+v", resp)
	}
}

func TestSyncAllOnline(t *testing.T) {
	ag := httptest.NewServer(adguardOKHandler())
	defer ag.Close()

	cfg := baseCfg()
	e, db, cleanup := testDeps(t, cfg)
	defer cleanup()

	// Seed one online node.
	n := &models.Node{
		Name: "x", BaseURL: ag.URL, Username: "u", Credential: "p",
		AuthKind: models.AuthKindBasic, Online: true, Version: "v-mock",
	}
	if err := db.Create(n).Error; err != nil {
		t.Fatal(err)
	}
	// Global config rows
	if err := db.Create(&models.GlobalConfig{Type: models.GlobalConfigTypeUpstream, Content: "8.8.8.8"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.GlobalConfig{Type: models.GlobalConfigTypeRewrite, Content: "[]"}).Error; err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync", strings.NewReader(`{}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d %s", rec.Code, rec.Body.String())
	}
	var resp syncResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Selection != "all_online" || len(resp.Results) != 1 || !resp.Results[0].OK {
		t.Fatalf("unexpected %+v", resp)
	}
	var after models.Node
	if err := db.First(&after, n.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.LastSyncAt == nil {
		t.Fatal("expected LastSyncAt set")
	}
}

func TestGetGlobalEmptyShape(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config/global", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d", rec.Code)
	}
	var g globalResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &g); err != nil {
		t.Fatal(err)
	}
	if g.Upstream != "" || string(g.Rewrite) != "[]" {
		t.Fatalf("unexpected %+v", g)
	}
}

func TestEmptyBodySync(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteNode204(t *testing.T) {
	cfg := baseCfg()
	e, db, cleanup := testDeps(t, cfg)
	defer cleanup()

	n := &models.Node{
		Name: "delme", BaseURL: "https://example.invalid", Username: "u", Credential: "p",
		AuthKind: models.AuthKindBasic, Online: false,
	}
	if err := db.Create(n).Error; err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/nodes/"+strconv.FormatUint(uint64(n.ID), 10), nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204 got %d %s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("want empty body, got %q", rec.Body.String())
	}
}

func TestPutGlobalRoundTrip(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	body := `{"upstream":"9.9.9.9","rewrite":[]}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/config/global", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d %s", rec.Code, rec.Body.String())
	}
	var g globalResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &g); err != nil {
		t.Fatal(err)
	}
	if g.Upstream != "9.9.9.9" || string(g.Rewrite) != "[]" {
		t.Fatalf("PUT response mismatch %+v", g)
	}

	greq := httptest.NewRequest(http.MethodGet, "/api/v1/config/global", nil)
	greq.Header.Set("Authorization", "Bearer admintok")
	grec := httptest.NewRecorder()
	e.ServeHTTP(grec, greq)
	if grec.Code != http.StatusOK {
		t.Fatalf("GET want 200 got %d", grec.Code)
	}
	var g2 globalResponse
	if err := json.Unmarshal(grec.Body.Bytes(), &g2); err != nil {
		t.Fatal(err)
	}
	if g2.Upstream != "9.9.9.9" || string(g2.Rewrite) != "[]" {
		t.Fatalf("GET after PUT mismatch %+v", g2)
	}
}

func TestInvalidNodeID(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes/not-a-number", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d", rec.Code)
	}
}
