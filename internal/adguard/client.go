package adguard

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/lensdns/dnsfleet/internal/models"
)

const defaultHTTPTimeout = 30 * time.Second

// Client calls AdGuard Home /control HTTP APIs.
type Client struct {
	baseURL *url.URL

	username   string
	credential string // basic: password; bearer: token (stored trimmed)
	authKind   string

	httpClient *http.Client
}

type clientConfig struct {
	timeout             time.Duration
	allowBearerForProxy bool
}

// ClientOption configures NewClient.
type ClientOption func(*clientConfig)

// WithHTTPTimeout sets the entire client round-trip timeout (including body read).
// Defaults to 30s if unset. Values <= 0 are rejected by NewClient after options apply.
func WithHTTPTimeout(d time.Duration) ClientOption {
	return func(c *clientConfig) {
		c.timeout = d
	}
}

// WithAllowBearerForProxy allows AuthKind bearer (Authorization: Bearer).
// Use only when this client talks to a front reverse proxy that terminates Bearer; the proxy must
// then authenticate to AdGuard Home using officially supported means (e.g. Basic). Stock AdGH
// does not document Bearer for /control on a direct install.
func WithAllowBearerForProxy() ClientOption {
	return func(c *clientConfig) {
		c.allowBearerForProxy = true
	}
}

// NewClient validates inputs and builds a Client. baseURL must include http/https scheme;
// it is normalized with models.NormalizeBaseURL then parsed (see detailed plan §2.1).
func NewClient(baseURL, username, credential, authKind string, opts ...ClientOption) (*Client, error) {
	cfg := clientConfig{
		timeout: defaultHTTPTimeout,
	}
	for _, o := range opts {
		o(&cfg)
	}
	if cfg.timeout <= 0 {
		return nil, fmt.Errorf("adguard: HTTP timeout must be positive")
	}

	normalized := models.NormalizeBaseURL(baseURL)
	u, err := url.Parse(normalized)
	if err != nil {
		return nil, fmt.Errorf("adguard: parse base URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("adguard: base URL scheme must be http or https")
	}
	if u.Host == "" {
		return nil, fmt.Errorf("adguard: base URL must include host")
	}

	cred := strings.TrimSpace(credential)
	if cred == "" {
		return nil, fmt.Errorf("adguard: credential must not be empty")
	}

	user := strings.TrimSpace(username)

	switch authKind {
	case models.AuthKindBasic:
		if user == "" {
			return nil, fmt.Errorf("adguard: username required for basic auth")
		}
	case models.AuthKindBearer:
		if !cfg.allowBearerForProxy {
			return nil, fmt.Errorf("adguard: %w", ErrBearerRequiresProxy)
		}
	default:
		return nil, fmt.Errorf("adguard: unknown auth kind %q (want %q or %q)", authKind, models.AuthKindBasic, models.AuthKindBearer)
	}

	cl := &http.Client{
		Timeout: cfg.timeout,
	}
	return &Client{
		baseURL:    u,
		username:   user,
		credential: cred,
		authKind:   authKind,
		httpClient: cl,
	}, nil
}

func joinControlURL(base *url.URL, segments ...string) (string, error) {
	if base == nil {
		return "", fmt.Errorf("adguard: nil base URL")
	}
	baseStr := strings.TrimSuffix(base.String(), "/")
	parts := append([]string{"control"}, segments...)
	joined, err := url.JoinPath(baseStr, parts...)
	if err != nil {
		return "", fmt.Errorf("adguard: join control URL: %w", err)
	}
	return joined, nil
}

func (c *Client) setAuth(req *http.Request) {
	switch c.authKind {
	case models.AuthKindBasic:
		raw := c.username + ":" + c.credential
		enc := base64.StdEncoding.EncodeToString([]byte(raw))
		req.Header.Set("Authorization", "Basic "+enc)
	case models.AuthKindBearer:
		req.Header.Set("Authorization", "Bearer "+c.credential)
	}
}

// do performs an HTTP request against /control/<segments...>. Caller must close resp.Body on non-nil resp.
// If body is non-nil, contentType should typically be "application/json" for AdGH write APIs.
func (c *Client) do(ctx context.Context, method string, body io.Reader, contentType string, controlSegments ...string) (*http.Response, error) {
	reqURL, err := joinControlURL(c.baseURL, controlSegments...)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, method, reqURL, body)
	if err != nil {
		return nil, fmt.Errorf("adguard: build request: %w", err)
	}

	c.setAuth(req)

	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		if body != nil {
			if strings.TrimSpace(contentType) == "" {
				return nil, fmt.Errorf("adguard: Content-Type required for %s with body", method)
			}
			req.Header.Set("Content-Type", contentType)
		}
	default:
		if body != nil && strings.TrimSpace(contentType) != "" {
			req.Header.Set("Content-Type", contentType)
		}
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("adguard: %s %s: %w", method, reqURL, err)
	}
	return resp, nil
}
