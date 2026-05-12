package config

import "fmt"

// ValidateStartupAdmin returns an error when admin auth is required but no token is configured.
// Call after Load and ApplyLaunchOverrides so CLI/env state is final.
func ValidateStartupAdmin(cfg *Config) error {
	if cfg == nil {
		return fmt.Errorf("config: nil")
	}
	if !cfg.AdminInsecureDisable && cfg.AdminToken == "" {
		return fmt.Errorf("admin token required: set DNSFLEET_ADMIN_TOKEN or pass -admin-token, or set DNSFLEET_ADMIN_INSECURE_DISABLE=1")
	}
	return nil
}
