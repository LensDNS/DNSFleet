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
