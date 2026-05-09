package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoad_Defaults(t *testing.T) {
	t.Setenv(envDBPath, "")
	t.Setenv(envHTTPAddr, "")
	t.Setenv(envAdminToken, "")
	t.Setenv(envAdminInsecure, "")
	t.Setenv(envSyncMaxConcurrent, "")
	t.Setenv(envSyncTotalTimeout, "")
	t.Setenv(envDriftInterval, "")
	t.Setenv(envWSMaxFrameBytes, "")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	wantDB, err := filepath.Abs(filepath.Clean(defaultDBPath))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DBPath != wantDB {
		t.Fatalf("DBPath: got %q want abs %q", cfg.DBPath, wantDB)
	}
	if cfg.HTTPAddr != defaultHTTPAddr {
		t.Fatalf("HTTPAddr: got %q want %q", cfg.HTTPAddr, defaultHTTPAddr)
	}
	if cfg.SyncMaxConcurrent != defaultSyncConcurrent {
		t.Fatalf("SyncMaxConcurrent: got %d want %d", cfg.SyncMaxConcurrent, defaultSyncConcurrent)
	}
	if cfg.SyncTotalTimeout != defaultDuration || cfg.DriftInterval != defaultDuration {
		t.Fatalf("durations: sync=%v drift=%v want %v", cfg.SyncTotalTimeout, cfg.DriftInterval, defaultDuration)
	}
	if cfg.AdminInsecureDisable {
		t.Fatal("AdminInsecureDisable should be false when unset")
	}
	if cfg.WsMaxFrameBytes != defaultWSMaxFrameBytes {
		t.Fatalf("WsMaxFrameBytes: got %d want %d", cfg.WsMaxFrameBytes, defaultWSMaxFrameBytes)
	}
}

func TestLoad_WSMaxFrameBytes(t *testing.T) {
	t.Setenv(envDBPath, filepath.Join(t.TempDir(), "x.db"))
	t.Setenv(envHTTPAddr, ":8080")
	t.Setenv(envWSMaxFrameBytes, "32768")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.WsMaxFrameBytes != 32768 {
		t.Fatalf("WsMaxFrameBytes: got %d", cfg.WsMaxFrameBytes)
	}
}

func TestLoad_WSMaxFrameBytes_invalid(t *testing.T) {
	t.Setenv(envDBPath, filepath.Join(t.TempDir(), "x.db"))
	t.Setenv(envHTTPAddr, ":8080")
	t.Setenv(envWSMaxFrameBytes, "0")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestLoad_CustomEnv(t *testing.T) {
	dir := t.TempDir()
	dbFile := filepath.Join(dir, "custom.db")
	t.Setenv(envDBPath, dbFile)
	t.Setenv(envHTTPAddr, "127.0.0.1:9090")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.Abs(filepath.Clean(dbFile))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DBPath != want {
		t.Fatalf("DBPath: got %q want %q", cfg.DBPath, want)
	}
	if cfg.HTTPAddr != "127.0.0.1:9090" {
		t.Fatalf("HTTPAddr: got %q", cfg.HTTPAddr)
	}
}

func TestLoad_CreatesParentDir(t *testing.T) {
	root := t.TempDir()
	dbFile := filepath.Join(root, "nested", "deep", "dnsfleet.db")
	t.Setenv(envDBPath, dbFile)
	t.Setenv(envHTTPAddr, ":8080")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.Abs(filepath.Clean(dbFile))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DBPath != want {
		t.Fatalf("DBPath: got %q want %q", cfg.DBPath, want)
	}
	st, err := os.Stat(filepath.Dir(dbFile))
	if err != nil {
		t.Fatal(err)
	}
	if !st.IsDir() {
		t.Fatal("expected parent directory to exist")
	}
}

func TestLoad_RejectsInMemoryDSN(t *testing.T) {
	t.Setenv(envHTTPAddr, "")

	for _, dsn := range []string{":memory:", "file::memory:", "FILE::memory:extra"} {
		t.Run(dsn, func(t *testing.T) {
			t.Setenv(envDBPath, dsn)
			_, err := Load()
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), "in-memory") {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
