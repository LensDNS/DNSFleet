package webui

import (
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/labstack/echo/v4"
)

// Mount registers GET/HEAD for embedded static assets and SPA fallback.
// Call only after /healthz and /api/v1 so API routes are not shadowed.
func Mount(e *echo.Echo) {
	e.GET("/", spaHandler)
	e.HEAD("/", spaHandler)
	e.GET("/*", spaHandler)
	e.HEAD("/*", spaHandler)
}

func spaHandler(c echo.Context) error {
	req := c.Request()
	switch req.Method {
	case http.MethodGet, http.MethodHead:
	default:
		return echo.ErrMethodNotAllowed
	}

	p := req.URL.Path
	if strings.HasPrefix(p, "/api/v1") {
		return echo.ErrNotFound
	}

	f, relName, err := resolveFile(p)
	if err != nil {
		return echo.ErrNotFound
	}
	defer f.Close()

	ct := contentTypeForPath(relName)
	c.Response().Header().Set(echo.HeaderContentType, ct)

	if req.Method == http.MethodHead {
		return c.NoContent(http.StatusOK)
	}

	c.Response().WriteHeader(http.StatusOK)
	_, err = io.Copy(c.Response().Writer, f)
	return err
}

func contentTypeForPath(relName string) string {
	ext := path.Ext(relName)
	if ext == ".html" {
		return "text/html; charset=utf-8"
	}
	if ext == ".js" {
		return "text/javascript; charset=utf-8"
	}
	if ext == ".css" {
		return "text/css; charset=utf-8"
	}
	if ext == ".json" {
		return "application/json; charset=utf-8"
	}
	if ext == ".svg" {
		return "image/svg+xml"
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func resolveFile(urlPath string) (fs.File, string, error) {
	trim := strings.TrimPrefix(path.Clean("/"+urlPath), "/")
	isNext := strings.HasPrefix(trim, "_next")

	f, name, err := tryExported(trim)
	if err == nil {
		return f, name, nil
	}
	if isNext {
		return nil, "", err
	}
	return tryExported("")
}

// tryExported resolves one path within the export root (Next output: 'export').
// It does not fall back to index.html except when rel is "" (caller uses that for SPA).
func tryExported(rel string) (fs.File, string, error) {
	if rel == "" {
		f, err := Static.Open("index.html")
		if err != nil {
			return nil, "", err
		}
		return f, "index.html", nil
	}

	f, err := Static.Open(rel)
	if err == nil {
		st, statErr := f.Stat()
		if statErr != nil {
			f.Close()
			return nil, "", statErr
		}
		if !st.IsDir() {
			return f, rel, nil
		}
		f.Close()
		idx := path.Join(rel, "index.html")
		f2, err2 := Static.Open(idx)
		if err2 == nil {
			return f2, idx, nil
		}
	}

	if !strings.Contains(path.Base(rel), ".") {
		html := rel + ".html"
		f2, err2 := Static.Open(html)
		if err2 == nil {
			return f2, html, nil
		}
	}

	return nil, "", fs.ErrNotExist
}
