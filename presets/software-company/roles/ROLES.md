# 软件公司 Harness — 角色库（ROLES）

> 本文件是角色库的权威可见记录（对应规格 §6）。角色固定存在；自适应策略只决定每轮实际启动哪些角色。
> 模型与 reasoning 硬约束（H-02）：Coordinator 唯一 max；planner/architect/generator/department-generator/integrator/sprint-evaluator/final-evaluator/security-reviewer/repair-generator 为 high；explorer/qa-runner 为 medium；mechanical-worker/recorder 为 low（五刀优化 v1.2）。`company_record_role` 对每次启动做硬校验。

**总数：14 个角色 = 13 个常设角色 + 1 个失败触发的 Repair Generator**

| # | 角色 id | 中文名 | 模型 | reasoning | 核心职责 | 禁止事项 | 触发方式 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | coordinator | Coordinator 项目总控 | deepseek-v4-pro | **max** | 分类、组队、派工、状态推进、冲突裁决、暂停与升级 | 不直接编码；不替 QA 放行 | 每个任务常驻 |
| 2 | planner | Planner 产品经理 | deepseek-v4-pro | high | 产品蓝图、用户故事、范围、非目标、Sprint 路线 | 不提前规定无必要的实现细节 | 中型及以上 |
| 3 | architect | 架构负责人 | deepseek-v4-pro | high | 模块边界、接口、数据结构、技术风险、依赖顺序 | 不承担产品取舍或最终验收 | 复杂/高风险 |
| 4 | generator | 主程序员 Generator | deepseek-v4-pro | high | 实现策略、核心代码、自检、协调部门程序员 | 不修改验收结论；不批准自己 | 所有类型 |
| 5 | department-generator | 部门程序员 | deepseek-v4-pro | high | 分别实现前端、后端、数据等独立模块 | 不越过文件所有权；不改共享表面 | 复杂/高风险 |
| 6 | integrator | Integrator 集成负责人 | deepseek-v4-pro | high | 合并提交、处理共享表面、解决集成冲突、全量回归 | 不绕过失败验收 | 复杂/高风险 |
| 7 | sprint-evaluator | Sprint Evaluator | deepseek-v4-pro | high | 审核合同，对单轮签发 PASS/FAIL | 不参与本轮编码；不修业务代码 | 中型及以上 |
| 8 | final-evaluator | 最终验收负责人 | deepseek-v4-pro | high | 在干净环境完成跨 Sprint 端到端验收 | 不参与任何 Sprint 实现 | 复杂/高风险+强制完整模式 |
| 9 | security-reviewer | 安全/数据迁移评审 | deepseek-v4-pro | high | 权限、支付、隐私、删除、迁移专项检查 | 不以普通功能通过替代安全通过 | 高风险强制 |
| 10 | explorer | Explorer 调查员 | deepseek-v4-flash | medium | 仓库、官方资料、依赖、测试入口和风险调查 | 只读；不修改代码 | 中型及以上 |
| 11 | qa-runner | QA 执行员 | deepseek-v4-flash | medium | UI、API、数据库、构建和回归测试；采集证据 | 不判最终结论；不修业务代码 | 中型及以上 |
| 12 | mechanical-worker | Mechanical Worker | deepseek-v4-flash | low | 明确、重复、可批量验证的机械任务 | 不处理歧义、架构或跨模块决策 | 按需 |
| 13 | recorder | Recorder 项目秘书 | deepseek-v4-flash | low | 状态、用量、证据索引、HANDOFF 和项目收据 | 只记录事实；不做产品或技术决策 | 中型及以上 |
| 14 | repair-generator | Repair Generator | deepseek-v4-pro | high | 根据冻结的失败报告定点修复 | 不扩大范围；不重写合同；不自行放行 | **任意 FAIL 硬触发** |

## 按任务类型的启动团队（自适应组队）

- **小型**：coordinator + generator（机械任务可加 mechanical-worker）；不启动 Planner/Sprint Evaluator/QA 执行员；合同由 Coordinator 冻结，必须 `deterministicCoverage=true`，否则编码前提升为中型。
- **中型**：coordinator + planner + explorer + generator + sprint-evaluator + qa-runner + recorder。
- **复杂**：中型团队 + architect + department-generator + integrator + final-evaluator。
- **高风险**：对应团队上强制追加 security-reviewer + final-evaluator。
- **任意验收 FAIL**：立即追加全新 repair-generator（deepseek-v4-pro/high，全新上下文）。

## 并发上限（写入角色）

小型 1 个；中型最多 3 个；复杂与高风险最多 2 个（五刀优化 v1.2）。高风险评审与编码不得在同一未冻结代码状态下并发。

## 记录位置

- 本文件：preset `roles/ROLES.md`（全局层权威副本）与项目 `.company-harness/ROLES.md`
- 机器可读：preset `roles/roles.json`
- 运行时查询：`company_get_role(role)` 单角色；`company_list_roles` 全量（新 preset 会话）；任务内登记：各任务 `RUN_STATE.json → rolesLaunched`（H-02 已校验）
