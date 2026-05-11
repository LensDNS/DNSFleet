package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
)

func TestPostNodeProbe_success_updates_online(t *testing.T) {
	ag := httptest.NewServer(adguardOKHandler())
	defer ag.Close()

	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	id := postOnlineNodeForQuerylog(t, e, ag.URL, "probeOK")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes/"+strconv.FormatUint(uint64(id), 10)+"/probe", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d %s", rec.Code, rec.Body.String())
	}
	var out nodeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !out.Online || out.Version != "v-mock" {
		t.Fatalf("unexpected %+v", out)
	}
}

func TestPostNodeProbe_offline_node_can_recover(t *testing.T) {
	ag := httptest.NewServer(adguardOKHandler())
	defer ag.Close()

	cfg := baseCfg()
	e, db, cleanup := testDeps(t, cfg)
	defer cleanup()

	id := postOnlineNodeForQuerylog(t, e, ag.URL, "probeRec")
	if err := db.Exec("UPDATE nodes SET online = 0 WHERE id = ?", id).Error; err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes/"+strconv.FormatUint(uint64(id), 10)+"/probe", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d %s", rec.Code, rec.Body.String())
	}
	var out nodeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !out.Online {
		t.Fatalf("want recovered online %+v", out)
	}
}

func TestPostNodeProbe_not_found_no_acquire(t *testing.T) {
	cfg := baseCfg()
	cfg.SyncMaxConcurrent = 1
	e, _, sem, cleanup := testDepsWithAdGHSem(t, cfg)
	defer cleanup()

	sem <- struct{}{}
	defer func() { <-sem }()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes/999/probe", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPostNodeProbe_upstream_fail_422(t *testing.T) {
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
		"name": "pb422", "base_url": bad.URL, "username": "u", "credential": "p", "auth_kind": "basic",
	}
	b, _ := json.Marshal(body)
	create := httptest.NewRequest(http.MethodPost, "/api/v1/nodes", strings.NewReader(string(b)))
	create.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	create.Header.Set("Authorization", "Bearer admintok")
	crec := httptest.NewRecorder()
	e.ServeHTTP(crec, create)
	if crec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 on create got %d %s", crec.Code, crec.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(crec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	node, _ := payload["node"].(map[string]any)
	idStr, _ := node["id"].(float64)
	id := uint(idStr)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes/"+strconv.FormatUint(uint64(id), 10)+"/probe", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPostNodeProbe_acquire_timeout_503(t *testing.T) {
	ag := httptest.NewServer(adguardOKHandler())
	defer ag.Close()

	cfg := baseCfg()
	cfg.SyncMaxConcurrent = 1
	e, _, sem, cleanup := testDepsWithAdGHSem(t, cfg)
	defer cleanup()

	postOnlineNodeForQuerylog(t, e, ag.URL, "probe503")

	sem <- struct{}{}
	defer func() { <-sem }()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/nodes/1/probe", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 got %d %s", rec.Code, rec.Body.String())
	}
}
