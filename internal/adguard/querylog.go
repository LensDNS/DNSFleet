package adguard

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

// QueryLogResponse is the success JSON for GET /control/querylog (OpenAPI name QueryLog).
// See api/ADGUARD_HOME_CONTROL_API.md §5; field set follows official schema (oldest + data).
type QueryLogResponse struct {
	Oldest string            `json:"oldest"`
	Data   []json.RawMessage `json:"data"`
}

// QueryLogConfigResponse is GET /control/querylog/config (OpenAPI GetQueryLogConfigResponse).
// Hub only requires Enabled; other fields are optional for decode tolerance.
type QueryLogConfigResponse struct {
	Enabled           bool `json:"enabled"`
	Interval          int  `json:"interval,omitempty"`
	AnonymizeClientIP bool `json:"anonymize_client_ip,omitempty"`
	IgnoredEnabled    bool `json:"ignored_enabled,omitempty"`
}

// GetQueryLog calls GET /control/querylog with the given query parameters.
//
// OpenAPI semantics (verify when upgrading AdGH):
//   - First page of the “latest” window: olderThan "" (omit older_than query key; do not send older_than=).
//   - Next page (e.g. browser REST pagination): set olderThan to the previous response’s Oldest (string cursor);
//     offset/limit per OpenAPI. The in-process querylog Hub uses a single tail GET per tick (no multi-page walk).
//   - responseStatus: use "all" unless filtering; empty string is treated as "all".
//   - search: optional; omitted from query when empty.
func (c *Client) GetQueryLog(ctx context.Context, olderThan string, offset, limit int, responseStatus, search string) (*QueryLogResponse, error) {
	if limit < 1 {
		return nil, fmt.Errorf("adguard: querylog limit must be positive")
	}
	if responseStatus == "" {
		responseStatus = "all"
	}
	q := url.Values{}
	if olderThan != "" {
		q.Set("older_than", olderThan)
	}
	q.Set("offset", strconv.Itoa(offset))
	q.Set("limit", strconv.Itoa(limit))
	q.Set("response_status", responseStatus)
	if search != "" {
		q.Set("search", search)
	}
	var out QueryLogResponse
	if err := c.doJSONGetQuery(ctx, &out, q, "querylog"); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetQueryLogConfig calls GET /control/querylog/config.
func (c *Client) GetQueryLogConfig(ctx context.Context) (*QueryLogConfigResponse, error) {
	var out QueryLogConfigResponse
	if err := c.doJSON(ctx, http.MethodGet, nil, "", &out, "querylog", "config"); err != nil {
		return nil, err
	}
	return &out, nil
}
