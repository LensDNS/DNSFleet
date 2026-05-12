package config

import "strings"

// ApplyLaunchOverrides merges non-empty CLI values into cfg after Load().
// cfg must be non-nil. Trimmed empty or whitespace-only flags are ignored (no override).
// Priority: non-empty flag over prior cfg fields (which came from env + defaults).
func ApplyLaunchOverrides(cfg *Config, adminTokenFlag, httpAddrFlag string) {
	if s := strings.TrimSpace(adminTokenFlag); s != "" {
		cfg.AdminToken = s
	}
	if s := strings.TrimSpace(httpAddrFlag); s != "" {
		cfg.HTTPAddr = s
	}
}
