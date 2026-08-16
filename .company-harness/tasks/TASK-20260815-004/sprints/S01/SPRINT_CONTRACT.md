# SPRINT_CONTRACT — TASK-20260815-004 / S01

- 冻结时间：2026-08-15T09:03:54.997Z
- 签署角色：sprint-evaluator
- 任务类型：medium
- 确定性门禁（小型）：不适用
- 计划末轮：是
- 合同校验值：6bb90aa0

> 冻结后合同不可修改；Generator 不得修改验收标准来迎合实现；Evaluator 不得顺手修代码。

## 目标\n待办列表：新增、标记完成、localStorage 持久化\n## 用户操作与可观察结果\nAC-01 输入文本点击添加 → 列表出现该项；AC-02 刷新页面 → 该项仍存在且字段一致；AC-03 勾选完成并刷新 → 完成状态保留\n## 技术证据\nUI-E2E-01（Playwright 实际点击）、DB-01（localStorage 键值断言）\n## 必测项\nUI-E2E-01、DB-01\n## 失败定义\n任一 AC 不通过或使用静态假数据/占位按钮冒充 → FAIL\n## 所有权\ngenerator 独占 demo-app/todo.js
