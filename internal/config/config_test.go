package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
	t.Setenv(envQueryLogMaxConcurrent, "")
	t.Setenv(envQueryLogPollInterval, "")
	t.Setenv(envQueryLogPageLimit, "")

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
	if cfg.WsMaxFrameBytes != DefaultWSMaxFrameBytes {
		t.Fatalf("WsMaxFrameBytes: got %d want %d", cfg.WsMaxFrameBytes, DefaultWSMaxFrameBytes)
	}
	if cfg.QueryLogMaxConcurrent != defaultQueryLogMaxConcurrent {
		t.Fatalf("QueryLogMaxConcurrent: got %d want %d", cfg.QueryLogMaxConcurrent, defaultQueryLogMaxConcurrent)
	}
	if cfg.QueryLogPollInterval != DefaultQueryLogPollInterval {
		t.Fatalf("QueryLogPollInterval: got %v want %v", cfg.QueryLogPollInterval, DefaultQueryLogPollInterval)
	}
	if cfg.QueryLogPageLimit != DefaultQueryLogPageLimit {
		t.Fatalf("QueryLogPageLimit: got %d want %d", cfg.QueryLogPageLimit, DefaultQueryLogPageLimit)
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

func TestLoad_QueryLogEnv(t *testing.T) {
	t.Setenv(envDBPath, filepath.Join(t.TempDir(), "x.db"))
	t.Setenv(envHTTPAddr, ":8080")
	t.Setenv(envQueryLogMaxConcurrent, "4")
	t.Setenv(envQueryLogPollInterval, "3s")
	t.Setenv(envQueryLogPageLimit, "50")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.QueryLogMaxConcurrent != 4 || cfg.QueryLogPollInterval != 3*time.Second || cfg.QueryLogPageLimit != 50 {
		t.Fatalf("querylog: %+v", cfg)
	}
}

func TestLoad_QueryLog_invalid(t *testing.T) {
	t.Setenv(envDBPath, filepath.Join(t.TempDir(), "x.db"))
	t.Setenv(envHTTPAddr, ":8080")
	t.Setenv(envQueryLogMaxConcurrent, "0")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for QUERYLOG_MAX_CONCURRENT=0")
	}
}

func TestLoad_QueryLogPoll_invalid(t *testing.T) {
	t.Setenv(envDBPath, filepath.Join(t.TempDir(), "x.db"))
	t.Setenv(envHTTPAddr, ":8080")
	t.Setenv(envQueryLogPollInterval, "0s")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for QUERYLOG_POLL_INTERVAL=0")
	}
}

func TestApplyLaunchOverrides(t *testing.T) {
	cases := []struct {
		name         string
		initial      Config
		adminFlag    string
		listenFlag   string
		wantAdmin    string
		wantHTTPAddr string
	}{
		{
			name: "empty flags leave cfg unchanged",
			initial: Config{
				AdminToken: "from-env",
				HTTPAddr:   ":8080",
			},
			adminFlag:    "",
			listenFlag:   "",
			wantAdmin:    "from-env",
			wantHTTPAddr: ":8080",
		},
		{
			name: "whitespace-only flags do not override",
			initial: Config{
				AdminToken: "from-env",
				HTTPAddr:   ":8080",
			},
			adminFlag:    " ",
			listenFlag:   " \t ",
			wantAdmin:    "from-env",
			wantHTTPAddr: ":8080",
		},
		{
			name: "non-empty admin overrides",
			initial: Config{
				AdminToken: "from-env",
				HTTPAddr:   ":8080",
			},
			adminFlag:    "cli-token",
			listenFlag:   "",
			wantAdmin:    "cli-token",
			wantHTTPAddr: ":8080",
		},
		{
			name: "non-empty listen overrides",
			initial: Config{
				AdminToken: "t",
				HTTPAddr:   ":8080",
			},
			adminFlag:    "",
			listenFlag:   ":18080",
			wantAdmin:    "t",
			wantHTTPAddr: ":18080",
		},
		{
			name: "both non-empty override both",
			initial: Config{
				AdminToken: "a",
				HTTPAddr:   ":1",
			},
			adminFlag:    "b",
			listenFlag:   ":2",
			wantAdmin:    "b",
			wantHTTPAddr: ":2",
		},
		{
			name: "trim admin and listen",
			initial: Config{
				AdminToken: "x",
				HTTPAddr:   ":y",
			},
			adminFlag:    "  z  ",
			listenFlag:   "  :9090  ",
			wantAdmin:    "z",
			wantHTTPAddr: ":9090",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := tc.initial
			ApplyLaunchOverrides(&cfg, tc.adminFlag, tc.listenFlag)
			if cfg.AdminToken != tc.wantAdmin {
				t.Fatalf("AdminToken: got %q want %q", cfg.AdminToken, tc.wantAdmin)
			}
			if cfg.HTTPAddr != tc.wantHTTPAddr {
				t.Fatalf("HTTPAddr: got %q want %q", cfg.HTTPAddr, tc.wantHTTPAddr)
			}
		})
	}
}

func TestValidateStartupAdmin(t *testing.T) {
	cases := []struct {
		name    string
		cfg     Config
		wantErr bool
	}{
		{
			name: "insecure disable allows empty token",
			cfg: Config{
				AdminInsecureDisable: true,
				AdminToken:           "",
			},
			wantErr: false,
		},
		{
			name: "token set ok",
			cfg: Config{
				AdminInsecureDisable: false,
				AdminToken:           "secret",
			},
			wantErr: false,
		},
		{
			name: "missing token when secure",
			cfg: Config{
				AdminInsecureDisable: false,
				AdminToken:           "",
			},
			wantErr: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateStartupAdmin(&tc.cfg)
			if tc.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected: %v", err)
			}
		})
	}
}

func TestValidateStartupAdmin_nil(t *testing.T) {
	err := ValidateStartupAdmin(nil)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestValidateStartupAdmin_afterOverrides(t *testing.T) {
	cfg := Config{
		AdminInsecureDisable: false,
		AdminToken:           "from-env",
	}
	ApplyLaunchOverrides(&cfg, "   ", "")
	if err := ValidateStartupAdmin(&cfg); err != nil {
		t.Fatalf("whitespace-only flag must not clear token: %v", err)
	}

	cfg2 := Config{
		AdminInsecureDisable: false,
		AdminToken:           "",
	}
	ApplyLaunchOverrides(&cfg2, "cli", "")
	if err := ValidateStartupAdmin(&cfg2); err != nil {
		t.Fatalf("cli override should satisfy gate: %v", err)
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
