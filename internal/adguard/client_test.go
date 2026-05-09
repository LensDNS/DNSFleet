package adguard

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/lensdns/dnsfleet/internal/models"
)

func TestNewClient_BearerRequiresProxy(t *testing.T) {
	t.Parallel()
	_, err := NewClient("http://localhost", "", "tok", models.AuthKindBearer)
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrBearerRequiresProxy) {
		t.Fatalf("expected ErrBearerRequiresProxy, got %v", err)
	}
}

func TestNewClient_BearerWithProxyOption(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/control/status" {
			http.NotFound(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		if auth != "Bearer secret-token" {
			http.Error(w, "bad auth", http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "", "secret-token", models.AuthKindBearer, WithAllowBearerForProxy())
	if err != nil {
		t.Fatal(err)
	}
	resp, err := c.do(context.Background(), http.MethodGet, nil, "", "status")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestDo_BasicAuthorization(t *testing.T) {
	t.Parallel()
	var gotUser, gotPass string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/control/status" {
			http.NotFound(w, r)
			return
		}
		h := r.Header.Get("Authorization")
		const prefix = "Basic "
		if !strings.HasPrefix(h, prefix) {
			http.Error(w, "no basic", http.StatusUnauthorized)
			return
		}
		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(h, prefix))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		user, pass, ok := strings.Cut(string(raw), ":")
		if !ok {
			http.Error(w, "bad basic payload", http.StatusBadRequest)
			return
		}
		gotUser, gotPass = user, pass
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "admin", "hunter2", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := c.do(context.Background(), http.MethodGet, nil, "", "status")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if gotUser != "admin" || gotPass != "hunter2" {
		t.Fatalf("basic mismatch: user=%q pass=%q", gotUser, gotPass)
	}
}

func TestNewClient_BasicEmptyUsername(t *testing.T) {
	t.Parallel()
	_, err := NewClient("http://localhost", "   ", "pw", models.AuthKindBasic)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNewClient_UnknownAuthKind(t *testing.T) {
	t.Parallel()
	_, err := NewClient("http://localhost", "u", "pw", "ldap")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNewClient_EmptyCredential(t *testing.T) {
	t.Parallel()
	_, err := NewClient("http://localhost", "u", "  ", models.AuthKindBasic)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNewClient_BadBaseURLScheme(t *testing.T) {
	t.Parallel()
	_, err := NewClient("ftp://localhost:80", "u", "pw", models.AuthKindBasic)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNewClient_BaseURLMissingHost(t *testing.T) {
	t.Parallel()
	_, err := NewClient("http:///nopath", "u", "pw", models.AuthKindBasic)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNewClient_InvalidHTTPTimeout(t *testing.T) {
	t.Parallel()
	_, err := NewClient("http://localhost", "u", "pw", models.AuthKindBasic, WithHTTPTimeout(-time.Second))
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestDo_PostMissingContentTypeWithBody(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "a", "b", models.AuthKindBasic)
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.do(context.Background(), http.MethodPost, strings.NewReader("{}"), "", "dns_config")
	if err == nil {
		t.Fatal("expected error when POST has body but Content-Type empty")
	}
}

func TestDo_ClientTimeout(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(srv.URL, "a", "b", models.AuthKindBasic, WithHTTPTimeout(20*time.Millisecond))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := c.do(context.Background(), http.MethodGet, nil, "", "status")
	if err == nil {
		if resp != nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
		t.Fatal("expected timeout error")
	}
	if resp != nil {
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
}

func TestJoinControlURL(t *testing.T) {
	t.Parallel()
	u, err := url.Parse("http://127.0.0.1:3000")
	if err != nil {
		t.Fatal(err)
	}
	got, err := joinControlURL(u, "status")
	if err != nil {
		t.Fatal(err)
	}
	want := "http://127.0.0.1:3000/control/status"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
