// Package config loads process configuration from environment variables with DNSFleet defaults.
// Admin credentials are not read here (Step 3).
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	envDBPath   = "DNSFLEET_DB_PATH"
	envHTTPAddr = "DNSFLEET_HTTP_ADDR"

	defaultDBPath   = "./data/dnsfleet.db"
	defaultHTTPAddr = ":8080"
)

// Config holds runtime settings resolved at startup.
type Config struct {
	// DBPath is the absolute path to the SQLite database file (not :memory:).
	// Load resolves relative env values against the process working directory at call time.
	DBPath string
	// HTTPAddr is the listen address for the HTTP server (e.g. ":8080").
	HTTPAddr string
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

	return Config{
		DBPath:   absDB,
		HTTPAddr: httpAddr,
	}, nil
}

func isMemoryDSN(p string) bool {
	lower := strings.ToLower(strings.TrimSpace(p))
	return lower == ":memory:" || strings.HasPrefix(lower, "file::memory:")
}
