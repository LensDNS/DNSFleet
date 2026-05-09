// Package config loads process configuration from environment variables with DNSFleet defaults.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	envDBPath             = "DNSFLEET_DB_PATH"
	envHTTPAddr           = "DNSFLEET_HTTP_ADDR"
	envAdminToken         = "DNSFLEET_ADMIN_TOKEN"
	envAdminInsecure      = "DNSFLEET_ADMIN_INSECURE_DISABLE"
	envSyncMaxConcurrent  = "DNSFLEET_SYNC_MAX_CONCURRENT"
	envSyncTotalTimeout   = "DNSFLEET_SYNC_TOTAL_TIMEOUT"
	envDriftInterval      = "DNSFLEET_DRIFT_INTERVAL"
	defaultDBPath         = "./data/dnsfleet.db"
	defaultHTTPAddr       = ":8080"
	defaultSyncConcurrent = 8
	defaultDuration       = 5 * time.Minute
)

// Config holds runtime settings resolved at startup.
type Config struct {
	DBPath   string
	HTTPAddr string

	// AdminToken is the shared secret for /api/v1 (Bearer or X-Admin-Token). May be empty when AdminInsecureDisable is true.
	AdminToken string
	// AdminInsecureDisable when true (env DNSFLEET_ADMIN_INSECURE_DISABLE=1 exactly) skips Admin middleware validation.
	AdminInsecureDisable bool

	SyncMaxConcurrent int
	SyncTotalTimeout  time.Duration
	DriftInterval     time.Duration
}

// Load reads configuration from the environment, applies defaults, and ensures the database parent directory exists.
func Load() (Config, error) {
	dbPath := strings.TrimSpace(os.Getenv(envDBPath))
	if dbPath == "" {
		dbPath = defaultDBPath
	}
	dbPath = filepath.Clean(dbPath)
	if dbPath == "" || dbPath == "." {
		return Config{}, fmt.Errorf("%s: empty path after clean", envDBPath)
	}
	if isMemoryDSN(dbPath) {
		return Config{}, fmt.Errorf("%s: in-memory DSN is not supported (use a file path)", envDBPath)
	}

	absDB, err := filepath.Abs(dbPath)
	if err != nil {
		return Config{}, fmt.Errorf("resolve db path: %w", err)
	}
	parent := filepath.Dir(absDB)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return Config{}, fmt.Errorf("create data directory %q: %w", parent, err)
	}

	httpAddr := strings.TrimSpace(os.Getenv(envHTTPAddr))
	if httpAddr == "" {
		httpAddr = defaultHTTPAddr
	}

	adminTok := os.Getenv(envAdminToken)
	insecure := strings.TrimSpace(os.Getenv(envAdminInsecure)) == "1"

	syncN := defaultSyncConcurrent
	if s := strings.TrimSpace(os.Getenv(envSyncMaxConcurrent)); s != "" {
		v, err := strconv.Atoi(s)
		if err != nil || v < 1 {
			return Config{}, fmt.Errorf("%s: want positive integer, got %q", envSyncMaxConcurrent, s)
		}
		syncN = v
	}

	syncTotal := defaultDuration
	if s := strings.TrimSpace(os.Getenv(envSyncTotalTimeout)); s != "" {
		d, err := time.ParseDuration(s)
		if err != nil {
			return Config{}, fmt.Errorf("%s: %w", envSyncTotalTimeout, err)
		}
		if d <= 0 {
			return Config{}, fmt.Errorf("%s: must be positive", envSyncTotalTimeout)
		}
		syncTotal = d
	}

	driftEvery := defaultDuration
	if s := strings.TrimSpace(os.Getenv(envDriftInterval)); s != "" {
		d, err := time.ParseDuration(s)
		if err != nil {
			return Config{}, fmt.Errorf("%s: %w", envDriftInterval, err)
		}
		if d <= 0 {
			return Config{}, fmt.Errorf("%s: must be positive", envDriftInterval)
		}
		driftEvery = d
	}

	return Config{
		DBPath:               absDB,
		HTTPAddr:             httpAddr,
		AdminToken:           strings.TrimSpace(adminTok),
		AdminInsecureDisable: insecure,
		SyncMaxConcurrent:    syncN,
		SyncTotalTimeout:     syncTotal,
		DriftInterval:        driftEvery,
	}, nil
}

func isMemoryDSN(p string) bool {
	lower := strings.ToLower(strings.TrimSpace(p))
	return lower == ":memory:" || strings.HasPrefix(lower, "file::memory:")
}
