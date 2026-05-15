package adguard

import (
	"context"
	"net/http"
)

// ServerStats is a minimal decode of GET /control/stats (OpenAPI `Stats`).
// DNSFleet only persists the fields mapped in api/ADGUARD_HOME_CONTROL_API.md §stats.
// v0.1.4 does not pass the optional `recent` query parameter.
type ServerStats struct {
	NumDNSQueries       int64   `json:"num_dns_queries"`
	NumBlockedFiltering int64   `json:"num_blocked_filtering"`
	AvgProcessingTime   float64 `json:"avg_processing_time"` // seconds
}

// GetStats calls GET /control/stats (no `recent` query).
func (c *Client) GetStats(ctx context.Context) (*ServerStats, error) {
	var st ServerStats
	if err := c.doJSON(ctx, http.MethodGet, nil, "", &st, "stats"); err != nil {
		return nil, err
	}
	return &st, nil
}
