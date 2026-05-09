package db

import (
	"os"
	"path/filepath"
	"testing"

	"gorm.io/gorm"
)

func TestOpenAndMigrate_Select1(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	db, err := OpenAndMigrate(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { closeGORM(t, db) })

	var n int
	if err := db.Raw("SELECT 1").Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("SELECT 1: got %d", n)
	}
}

func TestOpenAndMigrate_sqliteMasterHasExpectedTables(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	db, err := OpenAndMigrate(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { closeGORM(t, db) })

	var count int64
	err = db.Raw(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('nodes','global_configs')`).Scan(&count).Error
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("expected nodes + global_configs tables, sqlite_master count=%d", count)
	}
}

func TestOpenAndMigrate_recreateAfterDelete(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db1, err := OpenAndMigrate(path)
	if err != nil {
		t.Fatal(err)
	}
	closeGORM(t, db1)

	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}

	db2, err := OpenAndMigrate(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { closeGORM(t, db2) })

	var n int
	if err := db2.Raw("SELECT 1").Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("after recreate SELECT 1: got %d", n)
	}
}

func closeGORM(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("gorm DB(): %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close sql db: %v", err)
	}
}
