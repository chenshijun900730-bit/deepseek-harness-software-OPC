# TASK_BRIEF — TASK-20260815-001

- 创建时间：2026-08-15T08:48:21.564Z
- 运行模式：company
- 项目目录：/Users/xiaowanzi/Documents/Deepseek/software-company-harness
- 一句话需求：把演示应用首页的提交按钮颜色从灰色改成蓝色
- 分类：small（{"ambiguity":"low","moduleSpan":"single","dataImpact":false,"externalIntegration":false,"failureRisk":"low"}）
- 启动团队：coordinator, generator

## 团队模型与 reasoning（H-02）

| 角色 | 模型 | reasoning |
| --- | --- | --- |
| Coordinator 项目总控 | deepseek-v4-pro | max |
| 主程序员 Generator | deepseek-v4-pro | high |

## 协议摘要

1. 批准前不修改任何业务代码（H-03）。
2. 每轮编码前冻结 SPRINT_CONTRACT.md，完成标准冻结后不得修改。
3. 文件所有权互斥；共享表面仅 Integrator 串行修改（H-06/H-07）。
4. 任何 FAIL 直接路由全新 Repair Generator（deepseek-v4-pro/high）（H-09）。
5. 两次定点修复 → 一次重新规划 → 仍失败暂停（H-10）。
6. 新上下文只凭本目录文件与 Git 状态恢复（H-11）。
