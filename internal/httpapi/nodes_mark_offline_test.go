package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/lensdns/dnsfleet/internal/models"
)

func TestPostMarkNodeOffline_success(t *testing.T) {
	ag := httptest.NewServer(adguardOKHandler())
	defer ag.Close()

	cfg := baseCfg()
	e, db, cleanup := testDeps(t, cfg)
	defer cleanup()

	id := postOnlineNodeForQuerylog(t, e, ag.URL, "markOff")

	q := int64(100)
	if err := db.Model(&models.Node{}).Where("id = ?", id).Updates(map[string]any{
		"runtime_dns_queries": &q,
	}).Error; err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes/"+strconv.FormatUint(uint64(id), 10)+"/mark-offline", nil)
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
	if out.ID != id || out.Online {
		t.Fatalf("unexpected %+v", out)
	}
	if out.RuntimeDNSQueries != nil || out.RuntimeBlocked != nil {
		t.Fatalf("want cleared runtime in JSON got %+v", out)
	}

	var row models.Node
	if err := db.First(&row, id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Online {
		t.Fatal("db want online=false")
	}
}

func TestPostMarkNodeOffline_not_found(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes/9999/mark-offline", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPostMarkNodeOffline_bad_id(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes/abc/mark-offline", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPostMarkNodeOffline_zero_id(t *testing.T) {
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes/0/mark-offline", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d %s", rec.Code, rec.Body.String())
	}
}
