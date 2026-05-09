package adguard

// DNSConfig mirrors AdGuard Home OpenAPI components.schemas.DNSConfig (snake_case JSON).
// Used for GET /control/dns_info (DNSConfig slice of allOf) and POST /control/dns_config body only.
// Optional fields use pointers so omitted JSON keys stay omitted on round-trip where possible.
// See api/ADGUARD_HOME_CONTROL_API.md §3 and upstream openapi/openapi.yaml.
type DNSConfig struct {
	BootstrapDNS               []string `json:"bootstrap_dns,omitempty"`
	UpstreamDNS                []string `json:"upstream_dns,omitempty"`
	FallbackDNS                []string `json:"fallback_dns,omitempty"`
	UpstreamDNSFile            string   `json:"upstream_dns_file,omitempty"`
	ProtectionEnabled          *bool    `json:"protection_enabled,omitempty"`
	Ratelimit                  *int     `json:"ratelimit,omitempty"`
	RatelimitSubnetSubnetLenV4 *int     `json:"ratelimit_subnet_subnet_len_ipv4,omitempty"`
	RatelimitSubnetSubnetLenV6 *int     `json:"ratelimit_subnet_subnet_len_ipv6,omitempty"`
	RatelimitWhitelist         []string `json:"ratelimit_whitelist,omitempty"`
	BlockingMode               string   `json:"blocking_mode,omitempty"`
	BlockingIPv4               string   `json:"blocking_ipv4,omitempty"`
	BlockingIPv6               string   `json:"blocking_ipv6,omitempty"`
	BlockedResponseTTL         *int     `json:"blocked_response_ttl,omitempty"`
	ProtectionDisabledUntil    string   `json:"protection_disabled_until,omitempty"`
	EDNSCSEnabled              *bool    `json:"edns_cs_enabled,omitempty"`
	EDNSCSUseCustom            *bool    `json:"edns_cs_use_custom,omitempty"`
	EDNSCSCustomIP             string   `json:"edns_cs_custom_ip,omitempty"`
	DisableIPv6                *bool    `json:"disable_ipv6,omitempty"`
	DNSSecEnabled              *bool    `json:"dnssec_enabled,omitempty"`
	CacheSize                  *int     `json:"cache_size,omitempty"`
	CacheTTLMin                *int     `json:"cache_ttl_min,omitempty"`
	CacheTTLMax                *int     `json:"cache_ttl_max,omitempty"`
	CacheEnabled               *bool    `json:"cache_enabled,omitempty"`
	CacheOptimistic            *bool    `json:"cache_optimistic,omitempty"`
	UpstreamMode               string   `json:"upstream_mode,omitempty"`
	UsePrivatePTRResolvers     *bool    `json:"use_private_ptr_resolvers,omitempty"`
	ResolveClients             *bool    `json:"resolve_clients,omitempty"`
	LocalPTRUpstreams          []string `json:"local_ptr_upstreams,omitempty"`
	UpstreamTimeout            *int     `json:"upstream_timeout,omitempty"`
}
