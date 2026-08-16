## S01 QA 证据（小型确定性门禁，Coordinator 记录）

- 必测项 TEST-FOOTER-01：确定性自动测试
- 结果：FAIL —— 页脚仍显示硬编码年份「2025」，与当前年份不一致
- 测试输出：tests/test-footer-01.out（预期 2026 实际 2025）
- 复现步骤：运行 `node tests/test-footer-01.js`，断言页脚文本 == 当前年份
## 复验 #1（确定性门禁）

- TEST-FOOTER-01 复跑：仍 FAIL（输出 2024，与当前年份不一致）
- 输出：tests/test-footer-01-rerun-1.out
## 复验 #2（确定性门禁）

- TEST-FOOTER-01 复跑：仍 FAIL（输出 1999，与当前年份不一致）
- 输出：tests/test-footer-01-rerun-2.out