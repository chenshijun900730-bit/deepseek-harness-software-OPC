## S01 QA 证据（QA 执行员）

- UI-E2E-01（Playwright 实际点击）：输入「买牛奶」→ 点添加 → 列表出现该项；刷新 → 仍存在；勾选 → 刷新 → 完成状态保留。通过。
- DB-01：localStorage 键 demo-todos 包含 {text:'买牛奶', done:true}。通过。
- 证据文件：evidence/ui-e2e-01.png、evidence/db-01.json