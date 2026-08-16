# TASK_BRIEF — TASK-20260815-002

- 创建时间：2026-08-15T08:48:48.339Z
- 运行模式：auto
- 项目目录：/Users/xiaowanzi/Documents/Deepseek/software-company-harness
- 一句话需求：清空生产数据库 users 表并删除所有用户数据
- 分类：high-risk（{"ambiguity":"low","moduleSpan":"multi","dataImpact":true,"externalIntegration":false,"failureRisk":"high"}）
- 启动团队：coordinator, planner, architect, explorer, generator, department-generator, integrator, sprint-evaluator, qa-runner, recorder, final-evaluator, security-reviewer

## 团队模型与 reasoning（H-02）

| 角色 | 模型 | reasoning |
| --- | --- | --- |
| Coordinator 项目总控 | deepseek-v4-pro | max |
| Planner 产品经理 | deepseek-v4-pro | high |
| 架构负责人 | deepseek-v4-pro | high |
| Explorer 调查员 | deepseek-v4-flash | high |
| 主程序员 Generator | deepseek-v4-pro | high |
| 部门程序员 | deepseek-v4-pro | high |
| Integrator 集成负责人 | deepseek-v4-pro | high |
| Sprint Evaluator | deepseek-v4-pro | high |
| QA 执行员 | deepseek-v4-flash | high |
| Recorder 项目秘书 | deepseek-v4-flash | high |
| 最终验收负责人 | deepseek-v4-pro | high |
| 安全/数据迁移评审 | deepseek-v4-pro | high |

## 协议摘要

1. 批准前不修改任何业务代码（H-03）。
2. 每轮编码前冻结 SPRINT_CONTRACT.md，完成标准冻结后不得修改。
3. 文件所有权互斥；共享表面仅 Integrator 串行修改（H-06/H-07）。
4. 任何 FAIL 直接路由全新 Repair Generator（deepseek-v4-pro/high）（H-09）。
5. 两次定点修复 → 一次重新规划 → 仍失败暂停（H-10）。
6. 新上下文只凭本目录文件与 Git 状态恢复（H-11）。
