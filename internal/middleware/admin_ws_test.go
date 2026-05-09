package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/lensdns/dnsfleet/internal/config"
	"github.com/lensdns/dnsfleet/internal/middleware"
)

func mountAdminWSLogs(cfg config.Config) *echo.Echo {
	e := echo.New()
	g := e.Group("/api/v1/ws")
	g.Use(middleware.AdminWS(cfg))
	g.GET("/logs", func(c echo.Context) error {
		return nil
	})
	return e
}

func TestAdminWS_unauthorized_without_token(t *testing.T) {
	cfg := config.Config{AdminToken: "secret"}
	e := mountAdminWSLogs(cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/logs", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminWS_bad_request_bearer_vs_x_admin_token(t *testing.T) {
	cfg := config.Config{AdminToken: "secret"}
	e := mountAdminWSLogs(cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/logs", nil)
	req.Header.Set("Authorization", "Bearer secret")
	req.Header.Set("X-Admin-Token", "other")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminWS_bad_request_header_vs_query_token(t *testing.T) {
	cfg := config.Config{AdminToken: "secret"}
	e := mountAdminWSLogs(cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/logs?token=qsecret", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminWS_insecure_skips_auth(t *testing.T) {
	cfg := config.Config{
		AdminToken:           "secret",
		AdminInsecureDisable: true,
	}
	e := mountAdminWSLogs(cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/logs", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminWS_ok_bearer_only(t *testing.T) {
	cfg := config.Config{AdminToken: "secret"}
	e := mountAdminWSLogs(cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/logs", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminWS_ok_query_token_only(t *testing.T) {
	cfg := config.Config{AdminToken: "secret"}
	e := mountAdminWSLogs(cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/logs?token=secret", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d body=%s", rec.Code, rec.Body.String())
	}
}
