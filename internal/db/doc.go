// Package db 提供 DNSFleet 控制面 SQLite 连接与 GORM AutoMigrate（Step 1.4）。
//
// 驱动锁定为纯 Go 的 github.com/glebarez/sqlite（与详细开发计划 §1.4 一致）。
// 进程入口应使用 config.Load() 的 DBPath 调用 Open / OpenAndMigrate；Migrate 失败时须记录原因并退出（见 §1.5）。
package db
