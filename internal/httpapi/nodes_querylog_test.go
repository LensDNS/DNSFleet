package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/lensdns/dnsfleet/internal/adguard"
	"github.com/lensdns/dnsfleet/internal/models"
)

func adguardWithQuerylogHandler(t *testing.T, querylogHook func(w http.ResponseWriter, r *http.Request)) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case strings.HasSuffix(p, "/control/querylog") && r.Method == http.MethodGet:
			if querylogHook != nil {
				querylogHook(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(adguard.QueryLogResponse{Oldest: "", Data: nil})
		case strings.HasSuffix(p, "/control/status") && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"version": "v-mock"})
		case strings.HasSuffix(p, "/control/stats") && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"num_dns_queries":       100,
				"num_blocked_filtering": 10,
				"avg_processing_time":   0.005,
			})
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

func postOnlineNodeForQuerylog(t *testing.T, e *echo.Echo, agURL, name string) uint {
	t.Helper()
	body := map[string]any{
		"name": name, "base_url": agURL, "username": "u", "credential": "p", "auth_kind": models.AuthKindBasic,
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
	if !out.Online {
		t.Fatalf("want online node got %+v", out)
	}
	return out.ID
}

func TestGetNodeQueryLog_success_no_older_than(t *testing.T) {
	ag := httptest.NewServer(adguardWithQuerylogHandler(t, nil))
	defer ag.Close()

	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	postOnlineNodeForQuerylog(t, e, ag.URL, "qnode")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes/1/querylog", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d %s", rec.Code, rec.Body.String())
	}
	var out adguard.QueryLogResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
}

func TestGetNodeQueryLog_clamps_limit(t *testing.T) {
	var sawLimit string
	ag := httptest.NewServer(adguardWithQuerylogHandler(t, func(w http.ResponseWriter, r *http.Request) {
		sawLimit = r.URL.Query().Get("limit")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(adguard.QueryLogResponse{Oldest: "c1", Data: nil})
	}))
	defer ag.Close()

	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	postOnlineNodeForQuerylog(t, e, ag.URL, "q2")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes/1/querylog?limit=999", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d", rec.Code)
	}
	if sawLimit != "100" {
		t.Fatalf("upstream limit want 100 got %q", sawLimit)
	}
}

func TestGetNodeQueryLog_rejects_nonzero_offset(t *testing.T) {
	ag := httptest.NewServer(adguardWithQuerylogHandler(t, nil))
	defer ag.Close()
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	postOnlineNodeForQuerylog(t, e, ag.URL, "q3")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes/1/querylog?offset=1", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d %s", rec.Code, rec.Body.String())
	}
}

func TestGetNodeQueryLog_offline_422(t *testing.T) {
	ag := httptest.NewServer(adguardWithQuerylogHandler(t, nil))
	defer ag.Close()
	cfg := baseCfg()
	e, db, cleanup := testDeps(t, cfg)
	defer cleanup()

	id := postOnlineNodeForQuerylog(t, e, ag.URL, "off")
	if err := db.Model(&models.Node{}).Where("id = ?", id).Update("online", false).Error; err != nil {
		t.Fatal(err)
	}

	qreq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/querylog", id), nil)
	qreq.Header.Set("Authorization", "Bearer admintok")
	qrec := httptest.NewRecorder()
	e.ServeHTTP(qrec, qreq)
	if qrec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 got %d %s", qrec.Code, qrec.Body.String())
	}
}

func TestGetNodeQueryLog_upstream_401_502(t *testing.T) {
	ag := httptest.NewServer(adguardWithQuerylogHandler(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{}`)
	}))
	defer ag.Close()
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	postOnlineNodeForQuerylog(t, e, ag.URL, "q401")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes/1/querylog", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502 got %d %s", rec.Code, rec.Body.String())
	}
}

func TestGetNodeQueryLog_passes_older_than_and_search(t *testing.T) {
	var captured url.Values
	ag := httptest.NewServer(adguardWithQuerylogHandler(t, func(w http.ResponseWriter, r *http.Request) {
		captured = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(adguard.QueryLogResponse{Oldest: "", Data: nil})
	}))
	defer ag.Close()
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	postOnlineNodeForQuerylog(t, e, ag.URL, "qpass")

	path := "/api/v1/nodes/1/querylog?older_than=2020-01-01T00:00:00.000000000Z&search=example.com&response_status=blocked"
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d %s", rec.Code, rec.Body.String())
	}
	if captured.Get("older_than") != "2020-01-01T00:00:00.000000000Z" {
		t.Fatalf("older_than got %q", captured.Get("older_than"))
	}
	if captured.Get("search") != "example.com" {
		t.Fatalf("search got %q", captured.Get("search"))
	}
	if captured.Get("response_status") != "blocked" {
		t.Fatalf("response_status got %q", captured.Get("response_status"))
	}
}

func TestGetNodeQueryLog_omits_empty_search_in_upstream_url(t *testing.T) {
	var rawQuery string
	ag := httptest.NewServer(adguardWithQuerylogHandler(t, func(w http.ResponseWriter, r *http.Request) {
		rawQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(adguard.QueryLogResponse{Oldest: "", Data: nil})
	}))
	defer ag.Close()
	cfg := baseCfg()
	e, _, cleanup := testDeps(t, cfg)
	defer cleanup()
	postOnlineNodeForQuerylog(t, e, ag.URL, "qempty")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes/1/querylog", nil)
	req.Header.Set("Authorization", "Bearer admintok")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rawQuery, "search=") {
		t.Fatalf("empty search should be omitted from upstream query, got %q", rawQuery)
	}
}
