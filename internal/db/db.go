package db

import (
	"fmt"

	"github.com/glebarez/sqlite"
	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
)

// Open 使用纯 Go 驱动 github.com/glebarez/sqlite 打开 path 上的 SQLite 文件。
// path 建议使用 config.Load() 得到的绝对路径（父目录已存在）。
func Open(path string) (*gorm.DB, error) {
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("open sqlite %q: %w", path, err)
	}
	return db, nil
}

// Migrate 对 Node、GlobalConfig 执行 AutoMigrate。
// 失败时返回包装错误；调用方（§1.5 main）应记录日志并以非零退出，不得静默忽略。
func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&models.Node{}, &models.GlobalConfig{}); err != nil {
		return fmt.Errorf("auto migrate: %w", err)
	}
	return nil
}

// OpenAndMigrate 依次 Open 与 Migrate，便于进程入口一次完成初始化。
// 若 Migrate 失败会关闭已打开的 DB，避免句柄泄漏。
func OpenAndMigrate(path string) (*gorm.DB, error) {
	db, err := Open(path)
	if err != nil {
		return nil, err
	}
	if err := Migrate(db); err != nil {
		if sqlDB, cerr := db.DB(); cerr == nil {
			_ = sqlDB.Close()
		}
		return nil, err
	}
	return db, nil
}
