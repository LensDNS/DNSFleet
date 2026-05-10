package webui

import (
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestEmbedHasIndexHTML(t *testing.T) {
	t.Helper()
	f, err := Static.Open("index.html")
	if err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
}

func TestMount_IndexAndFleetHTML(t *testing.T) {
	e := echo.New()
	e.GET("/healthz", func(c echo.Context) error { return c.String(http.StatusOK, "ok") })
	Mount(e)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET / = %d", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("GET / Content-Type = %q want text/html prefix", ct)
	}
	body, _ := io.ReadAll(rec.Body)
	if len(body) < 10 {
		t.Fatalf("short body")
	}

	req2 := httptest.NewRequest(http.MethodGet, "/fleet", nil)
	rec2 := httptest.NewRecorder()
	e.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET /fleet = %d", rec2.Code)
	}
	ct2 := rec2.Header().Get("Content-Type")
	if !strings.HasPrefix(ct2, "text/html") {
		t.Fatalf("GET /fleet Content-Type = %q want text/html prefix", ct2)
	}
}

func TestMount_HEADRoot_200EmptyBody(t *testing.T) {
	e := echo.New()
	Mount(e)

	req := httptest.NewRequest(http.MethodHead, "/", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("HEAD / = %d want 200", rec.Code)
	}
	b, _ := io.ReadAll(rec.Body)
	if len(b) != 0 {
		t.Fatalf("HEAD / body len = %d want 0", len(b))
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("HEAD / Content-Type = %q want text/html prefix", ct)
	}
}

func TestEmbedHasNextCSSChunk(t *testing.T) {
	t.Helper()
	var nextCount int
	_ = fs.WalkDir(Static, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if strings.HasPrefix(path, "_next") && !d.IsDir() {
			nextCount++
		}
		return nil
	})
	if nextCount == 0 {
		t.Fatalf("embed has no files under _next/ (got 0); check //go:embed and internal/webui/dist contents at compile time")
	}
	_, err := Static.Open("_next/static/chunks/0d586np2i0zz6.css")
	if err != nil {
		t.Fatalf("embed missing css: %v", err)
	}
}

func TestMount_nextStaticChunk(t *testing.T) {
	e := echo.New()
	Mount(e)
	req := httptest.NewRequest(http.MethodGet, "/_next/static/chunks/0d586np2i0zz6.css", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /_next/static/chunks/0d586np2i0zz6.css = %d body=%.200s", rec.Code, rec.Body.String())
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "text/css") {
		t.Fatalf("Content-Type = %q want text/css prefix", ct)
	}
}

func TestMount_APIPrefixNotSPA(t *testing.T) {
	e := echo.New()
	Mount(e)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /api/v1/nodes on ui-only router = %d want 404", rec.Code)
	}
}
