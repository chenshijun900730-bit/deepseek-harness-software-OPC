# TASK_BRIEF — TASK-20260815-004

- 创建时间：2026-08-15T08:48:48.565Z
- 运行模式：auto
- 项目目录：/Users/xiaowanzi/Documents/Deepseek/software-company-harness
- 一句话需求：给演示应用增加本地待办列表：新增待办、标记完成并持久化到浏览器 localStorage
- 分类：medium（{"ambiguity":"low","moduleSpan":"single","dataImpact":true,"externalIntegration":false,"failureRisk":"low"}）
- 启动团队：coordinator, planner, explorer, generator, sprint-evaluator, qa-runner, recorder

## 团队模型与 reasoning（H-02）

| 角色 | 模型 | reasoning |
| --- | --- | --- |
| Coordinator 项目总控 | deepseek-v4-pro | max |
| Planner 产品经理 | deepseek-v4-pro | high |
| Explorer 调查员 | deepseek-v4-flash | high |
| 主程序员 Generator | deepseek-v4-pro | high |
| Sprint Evaluator | deepseek-v4-pro | high |
| QA 执行员 | deepseek-v4-flash | high |
| Recorder 项目秘书 | deepseek-v4-flash | high |

## 协议摘要

1. 批准前不修改任何业务代码（H-03）。
2. 每轮编码前冻结 SPRINT_CONTRACT.md，完成标准冻结后不得修改。
3. 文件所有权互斥；共享表面仅 Integrator 串行修改（H-06/H-07）。
4. 任何 FAIL 直接路由全新 Repair Generator（deepseek-v4-pro/high）（H-09）。
5. 两次定点修复 → 一次重新规划 → 仍失败暂停（H-10）。
6. 新上下文只凭本目录文件与 Git 状态恢复（H-11）。
