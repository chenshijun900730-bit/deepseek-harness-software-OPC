## S02 实现记录（generator，重规划后重实现）

- 构建期注入 CURRENT_YEAR；页脚读取常量。
- 自检执行 TEST-FOOTER-02：本地结果 FAIL（部署脚本注入值错误，注入 2021）。
- commit: impl-20260815-003b（模拟）