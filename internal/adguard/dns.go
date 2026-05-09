package adguard

import (
	"context"
	"net/http"
	"strings"
)

// GetDNSConfig calls GET /control/dns_info and decodes the DNSConfig portion of the response.
// Extra top-level keys from the allOf response are ignored by encoding/json.
func (c *Client) GetDNSConfig(ctx context.Context) (*DNSConfig, error) {
	var cfg DNSConfig
	if err := c.doJSON(ctx, http.MethodGet, nil, "", &cfg, "dns_info"); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// SetUpstreamDNSFromGlobalText reads dns_info, replaces upstream_dns with lines parsed from
// upstreamLines (GlobalConfig Type=upstream: one upstream per non-empty trimmed line, §1.3),
// and POSTs /control/dns_config.
func (c *Client) SetUpstreamDNSFromGlobalText(ctx context.Context, upstreamLines string) error {
	cfg, err := c.GetDNSConfig(ctx)
	if err != nil {
		return err
	}
	cfg.UpstreamDNS = parseUpstreamLines(upstreamLines)
	return c.postJSON(ctx, cfg, "dns_config")
}

func parseUpstreamLines(text string) []string {
	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		s := strings.TrimSpace(line)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
