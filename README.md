# DNSFleet

**Unified Control Plane for AdGuard Home Fleets.**  
多节点 AdGuard Home 的统一控制面（v0.1 开发中）。

## 文档与协作说明

产品需求、开发路线图、AI 分步提示、审查提示及根目录 **`AGENTS.md`** 等 **仅存维护者本机**，**不**纳入本 Git 远程（见仓库根目录 `.gitignore` 说明）。克隆本仓库若需相同资料，请从维护者提供的私有渠道获取。

## 仓库布局（代码）

| 路径 | 说明 |
|------|------|
| `cmd/dnsfleet/` | Go 可执行入口 |
| `internal/` | 应用私有代码 |
| `api/` | 预留 API 契约 |
| `web/` | 预留前端工程 |
| `deploy/` | 预留容器与编排 |
| `scripts/` | 可选脚本 |

## 状态

目录骨架与忽略规则已就绪；业务实现按维护者本机路线图自 Step 1 起推进。

## 许可证

待定；确定后于本仓库根目录添加 `LICENSE`。
