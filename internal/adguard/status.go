package adguard

import (
	"context"
	"net/http"
)

// ServerStatus is a loose decode of GET /control/status (api/ADGUARD_HOME_CONTROL_API.md §2).
// Callers should treat fields other than Version as best-effort; AdGH may add or omit keys.
type ServerStatus struct {
	Version           string   `json:"version"`
	Running           *bool    `json:"running,omitempty"`
	DNSAddresses      []string `json:"dns_addresses,omitempty"`
	DNSPort           *int     `json:"dns_port,omitempty"`
	HTTPPort          *int     `json:"http_port,omitempty"`
	ProtectionEnabled *bool    `json:"protection_enabled,omitempty"`
	Language          string   `json:"language,omitempty"`
	// start_time is omitted: AdGuard Home v0.107+ returns it as a fractional JSON number (ms since epoch);
	// unmarshaling into int64 fails and breaks GetStatus even when HTTP 200. Version is enough for probe.
	ProtectionDisabledUntil string `json:"protection_disabled_until,omitempty"`
}

// GetStatus calls GET /control/status and decodes JSON into ServerStatus.
func (c *Client) GetStatus(ctx context.Context) (*ServerStatus, error) {
	var st ServerStatus
	if err := c.doJSON(ctx, http.MethodGet, nil, "", &st, "status"); err != nil {
		return nil, err
	}
	return &st, nil
}
