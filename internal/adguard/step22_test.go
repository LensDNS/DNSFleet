package adguard

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lensdns/dnsfleet/internal/models"
)

func TestGetStatus(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/control/status" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"version":"v0.107.0","running":true}`)
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "a", "b", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	st, err := c.GetStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if st.Version != "v0.107.0" {
		t.Fatalf("version %q", st.Version)
	}
	if st.Running == nil || !*st.Running {
		t.Fatalf("running: %+v", st.Running)
	}
}

func TestGetDNSConfig_SetUpstreamDNSFromGlobalText(t *testing.T) {
	t.Parallel()
	const firstBody = `{"upstream_dns":["tls://old.example"],"cache_ttl_max":42,"default_local_ptr_upstreams":[]}`
	var posted string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/control/dns_info" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, firstBody)
		case r.URL.Path == "/control/dns_config" && r.Method == http.MethodPost:
			b, _ := io.ReadAll(r.Body)
			posted = string(b)
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "a", "b", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	err = c.SetUpstreamDNSFromGlobalText(context.Background(), "\n tls://1.1.1.1 \n\n tls://8.8.8.8 \n")
	if err != nil {
		t.Fatal(err)
	}
	var got DNSConfig
	if err := json.Unmarshal([]byte(posted), &got); err != nil {
		t.Fatalf("post body: %v", err)
	}
	wantUpstream := []string{"tls://1.1.1.1", "tls://8.8.8.8"}
	if len(got.UpstreamDNS) != len(wantUpstream) {
		t.Fatalf("upstream_dns %#v", got.UpstreamDNS)
	}
	for i := range wantUpstream {
		if got.UpstreamDNS[i] != wantUpstream[i] {
			t.Fatalf("upstream_dns %#v", got.UpstreamDNS)
		}
	}
	if got.CacheTTLMax == nil || *got.CacheTTLMax != 42 {
		t.Fatalf("cache_ttl_max lost: %+v", got.CacheTTLMax)
	}
}

func TestApplyRewritesFromJSON_deleteThenAddOrder(t *testing.T) {
	t.Parallel()
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/control/rewrite/list" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `[{"domain":"a.test","answer":"1.1.1.1"},{"domain":"b.test","answer":"2.2.2.2"}]`)
		case r.URL.Path == "/control/rewrite/delete" && r.Method == http.MethodPost:
			calls = append(calls, "delete")
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/control/rewrite/add" && r.Method == http.MethodPost:
			calls = append(calls, "add")
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/control/rewrite/update" && r.Method == http.MethodPut:
			calls = append(calls, "update")
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "a", "b", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	desired := `[{"domain":"b.test","answer":"2.2.2.2"},{"domain":"c.test","answer":"3.3.3.3"}]`
	if err := c.ApplyRewritesFromJSON(context.Background(), []byte(desired)); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 2 || calls[0] != "delete" || calls[1] != "add" {
		t.Fatalf("call order %v (want delete then add)", calls)
	}
}

func TestApplyRewritesFromJSON_updateAfterDelete(t *testing.T) {
	t.Parallel()
	truth := true
	enabled := func(b bool) *bool { return &b }
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/control/rewrite/list" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			list := []RewriteEntry{
				{Domain: "x.test", Answer: "9.9.9.9", Enabled: enabled(false)},
				{Domain: "keep.test", Answer: "1.1.1.1", Enabled: enabled(false)},
			}
			_ = json.NewEncoder(w).Encode(list)
		case r.URL.Path == "/control/rewrite/delete" && r.Method == http.MethodPost:
			calls = append(calls, "delete")
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/control/rewrite/update" && r.Method == http.MethodPut:
			calls = append(calls, "update")
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/control/rewrite/add" && r.Method == http.MethodPost:
			calls = append(calls, "add")
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "a", "b", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	desired, _ := json.Marshal([]RewriteEntry{
		{Domain: "keep.test", Answer: "1.1.1.1", Enabled: &truth},
	})
	if err := c.ApplyRewritesFromJSON(context.Background(), desired); err != nil {
		t.Fatal(err)
	}
	want := []string{"delete", "update"}
	if len(calls) != len(want) {
		t.Fatalf("calls %v", calls)
	}
	for i := range want {
		if calls[i] != want[i] {
			t.Fatalf("calls %v want %v", calls, want)
		}
	}
}

func TestDoJSON_Unauthorized(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusUnauthorized)
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "a", "b", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	err = c.doJSON(context.Background(), http.MethodGet, nil, "", nil, "status")
	if !IsHTTPUnauthorized(err) {
		t.Fatalf("expected 401, got %v", err)
	}
}

func TestDoJSON_Forbidden(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "denied", http.StatusForbidden)
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "a", "b", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	err = c.doJSON(context.Background(), http.MethodGet, nil, "", nil, "status")
	if !IsHTTPForbidden(err) {
		t.Fatalf("expected 403, got %v", err)
	}
}

func TestDoJSON_InvalidJSONOn200(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `not json`)
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "a", "b", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	var dst map[string]any
	err = c.doJSON(context.Background(), http.MethodGet, nil, "", &dst, "status")
	if !IsJSONDecodeError(err) {
		t.Fatalf("expected JSON decode error, got %v", err)
	}
}

func TestParseUpstreamLines(t *testing.T) {
	t.Parallel()
	got := parseUpstreamLines("\n a \n\n b \n")
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("%q", got)
	}
}

func TestHTTPStatusError(t *testing.T) {
	t.Parallel()
	err := httpStatusToErr(500)
	if HTTPStatusCode(err) != 500 {
		t.Fatalf("code %d", HTTPStatusCode(err))
	}
	if strings.Contains(err.Error(), "hunter2") {
		t.Fatal("unexpected leak")
	}
}
