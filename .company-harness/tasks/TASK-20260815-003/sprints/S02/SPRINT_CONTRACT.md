# SPRINT_CONTRACT — TASK-20260815-003 / S02

- 冻结时间：2026-08-15T09:03:08.003Z
- 签署角色：coordinator
- 任务类型：small
- 确定性门禁（小型）：true（true）
- 计划末轮：是
- 合同校验值：463f2f60

> 冻结后合同不可修改；Generator 不得修改验收标准来迎合实现；Evaluator 不得顺手修代码。

## 目标（重规划后 S02）
按重规划方案修复页脚年份：构建期注入 CURRENT_YEAR。
## 非目标
不引入运行时依赖；不改页脚以外任何内容。
## 用户操作
1. 打开演示应用首页并滚动到页脚。
## 可观察结果
1. 页脚显示当前年份。
## 技术证据
- 确定性测试 TEST-FOOTER-02 断言注入的 CURRENT_YEAR == 当前年份，且页脚文本 == CURRENT_YEAR。
## 必测项
- TEST-FOOTER-02（覆盖全部验收标准）。
## 失败定义
- 任一断言不通过 → FAIL；重新规划后仍 FAIL → 暂停（H-10）。
## 文件所有权
- generator 独占：demo-app/ 下页脚相关文件。
