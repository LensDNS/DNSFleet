// Package models 存放 DNSFleet 的 GORM 领域模型（Step 1.3：Node、GlobalConfig）。
//
// 设计依据：维护者本机 docs/详细开发计划.md §1.3；rewrite 的 Content 元素形状见仓库 api/ADGUARD_HOME_CONTROL_API.md §4（RewriteEntry）。
//
// 在线状态：PRD / 详细开发计划中的「节点在线状态」在代码与 DB 列中字段名为 Online（bool，true=在线）；勿与 HTTP 状态码或表头字面「Status」混淆。
package models
