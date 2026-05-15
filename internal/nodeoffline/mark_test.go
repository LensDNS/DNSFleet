package nodeoffline

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	fleetdb "github.com/lensdns/dnsfleet/internal/db"
	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestMark_sets_offline_and_clears_runtime(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "nodeoffline.db")
	db, err := fleetdb.OpenAndMigrate(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	t.Cleanup(func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	})

	q := int64(42)
	b := int64(3)
	ms := int64(12)
	at := time.Now().UTC().Add(-time.Minute)
	n := models.Node{
		Name:                    "n1",
		BaseURL:                 "http://example",
		Username:                "u",
		Credential:              "p",
		AuthKind:                models.AuthKindBasic,
		Online:                  true,
		Version:                 "v9",
		LastPingMs:              99,
		RuntimeDNSQueries:       &q,
		RuntimeBlockedFiltering: &b,
		RuntimeAvgProcessingMs:  &ms,
		RuntimeStatsAt:          &at,
	}
	if err := db.Create(&n).Error; err != nil {
		t.Fatal(err)
	}

	if err := Mark(context.Background(), db, n.ID); err != nil {
		t.Fatal(err)
	}

	var got models.Node
	if err := db.First(&got, n.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Online {
		t.Fatal("want online=false")
	}
	if got.Version != "" || got.LastPingMs != 0 {
		t.Fatalf("want cleared probe fields got version=%q last_ping=%d", got.Version, got.LastPingMs)
	}
	if got.RuntimeDNSQueries != nil || got.RuntimeBlockedFiltering != nil || got.RuntimeAvgProcessingMs != nil || got.RuntimeStatsAt != nil {
		t.Fatalf("want nil runtime fields got dns=%v blocked=%v avg=%v at=%v",
			got.RuntimeDNSQueries, got.RuntimeBlockedFiltering, got.RuntimeAvgProcessingMs, got.RuntimeStatsAt)
	}
}

func TestMark_idempotent(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "nodeoffline2.db")
	db, err := fleetdb.OpenAndMigrate(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	t.Cleanup(func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	})

	n := models.Node{
		Name:       "n2",
		BaseURL:    "http://example",
		Username:   "u",
		Credential: "p",
		AuthKind:   models.AuthKindBasic,
		Online:     true,
		Version:    "v1",
	}
	if err := db.Create(&n).Error; err != nil {
		t.Fatal(err)
	}
	if err := Mark(context.Background(), db, n.ID); err != nil {
		t.Fatal(err)
	}
	if err := Mark(context.Background(), db, n.ID); err != nil {
		t.Fatal(err)
	}
	var got models.Node
	if err := db.First(&got, n.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Online {
		t.Fatal("want still offline")
	}
}
