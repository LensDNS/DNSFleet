# cmd/dnsfleet

- **Go module**：`github.com/lensdns/dnsfleet`（仓库根 `go.mod`）。
- **可执行入口**：本目录 [`main.go`](main.go)：`config.Load()` → SQLite（glebarez）`OpenAndMigrate` → **Echo v4** 监听 `DNSFLEET_HTTP_ADDR`，路由 **`GET /healthz`** → 200，body `ok`。

## 构建与运行

```bash
go build -o bin/dnsfleet ./cmd/dnsfleet
./bin/dnsfleet
```

或使用默认路径：

```bash
go run ./cmd/dnsfleet
```

进程日志会打印监听地址与 SQLite 绝对路径（不含密码）。环境变量见仓库根 [`README.md`](../../README.md) Configuration。

验收：`go build ./cmd/dnsfleet` 见 `docs/详细开发计划.md` §1.6（维护者本机）。
