package adguard

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lensdns/dnsfleet/internal/models"
)

func TestGetQueryLog_success(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/control/querylog" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		if got := r.URL.Query().Get("response_status"); got != "all" {
			t.Fatalf("response_status: %q", got)
		}
		if got := r.URL.Query().Get("limit"); got != "100" {
			t.Fatalf("limit: %q", got)
		}
		if _, has := r.URL.Query()["older_than"]; has {
			t.Fatalf("first-page query must omit older_than, got %q", r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"oldest": "2024-01-02T00:00:00.000000000Z",
			"data": []map[string]any{
				{"time": "2024-01-02T00:00:01.000000000Z"},
			},
		})
	}))
	defer ts.Close()

	cl, err := NewClient(ts.URL, "u", "p", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	out, err := cl.GetQueryLog(context.Background(), "", 0, 100, "all", "")
	if err != nil {
		t.Fatal(err)
	}
	if out.Oldest == "" || len(out.Data) != 1 {
		t.Fatalf("unexpected: %+v", out)
	}
}

func TestGetQueryLog_setsOlderThanWhenNonEmpty(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/control/querylog" {
			http.NotFound(w, r)
			return
		}
		if got := r.URL.Query().Get("older_than"); got != "2024-01-01T00:00:00.000000000Z" {
			t.Fatalf("older_than: got %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"oldest": "", "data": []any{}})
	}))
	defer ts.Close()

	cl, err := NewClient(ts.URL, "u", "p", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	_, err = cl.GetQueryLog(context.Background(), "2024-01-01T00:00:00.000000000Z", 0, 10, "all", "")
	if err != nil {
		t.Fatal(err)
	}
}

func TestGetQueryLogConfig_success(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/control/querylog/config" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"enabled":             true,
			"interval":            90,
			"anonymize_client_ip": false,
			"ignored":             []any{},
		})
	}))
	defer ts.Close()

	cl, err := NewClient(ts.URL, "u", "p", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := cl.GetQueryLogConfig(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Enabled {
		t.Fatal("expected enabled")
	}
}

func TestNewClientFromNode_bearerProxy(t *testing.T) {
	n := &models.Node{
		BaseURL:    "http://127.0.0.1:1",
		Username:   "",
		Credential: "tok",
		AuthKind:   models.AuthKindBearer,
	}
	cl, err := NewClientFromNode(n)
	if err != nil {
		t.Fatal(err)
	}
	if cl == nil {
		t.Fatal("nil client")
	}
}
