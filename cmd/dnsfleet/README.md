# cmd/dnsfleet

- **Go module**：`github.com/lensdns/dnsfleet`（仓库根 `go.mod`）。
- **可执行入口包**：`./cmd/dnsfleet`（从此目录构建二进制：`go build -o bin/dnsfleet ./cmd/dnsfleet`；**§1.1 不要求** 已有 `main.go`）。
- `main.go`：在 `docs/详细开发计划.md` **§1.5** 落地；`go build ./cmd/dnsfleet` 作为硬验收在 **§1.6**。当前目录在 §1.1 仅作入口约定说明。
