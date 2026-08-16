# 验收记录（P1–P3）

> 本文件是验收打钩记录。冒烟（Task 14/21）、招聘验收（V5）、五场景验收（Task 26）完成一条勾一条。

## 冒烟清单（新会话执行，V1–V4 前置）

- [ ] 新开会话后：右上角出现「🏢 Company」+「🗺 总监大画布」两个胶囊，无 "Failed to load plugins" 横幅
- [ ] 打开 /company：深色大画布页正常渲染（非 404 / 非 SPA 首页）
- [ ] 发复杂任务后：顶栏出现项目 chip，点 chip 画出 DAG（产品→架构→前端/后端/数据并行→集成→QA→终验→发布）
- [ ] 右栏事件流滚动出现 task.created / status 事件
- [ ] 拖动节点：连线与 📄 图标跟随；「⟲ 自动布局」可复位
- [ ] 悬停节点：信息卡弹出且不遮挡；悬停 📄：契约摘要弹出
- [ ] 并发滑杆 2/3/4：事件流出现 concurrency.changed
- [ ] 🔔 审批面板：WAITING_INITIAL_APPROVAL 任务可批准/拒绝，事件流留痕
- [ ] 旧任务 chip（TASK-001/002/003）：flow 接口回退 17 步线性视图不报错（V6）

## P2 验收（V5 招聘）

- [ ] 画布「＋ 招聘部门」→ 填 qa-auto/自动化测试部 → 招聘成功（授权 ~/.dsh 写入）
- [ ] `~/.dsh/.agent-presets/company-dept-qa-auto/` 出现 agent.cordis.yml
- [ ] roles.json 出现 qa-auto（source: hired）；事件流出现 dept.hired
- [ ] company_adjust_flow 把 qa-auto 插入流程 → 派工成功（子代理无 company_* 工具）
- [ ] 撤销：/company-api/action?action=undoHire&id=qa-auto → ok；目录归档 .archived-*

## P3 五场景 + 破坏性暂停（Task 26）

- [ ] 场景① 小型 UI 修改：确定性徽章 + contracts/ 契约生成
- [ ] 场景② 中型持久化：explorer 缓存文件；无 final-evaluator 环节
- [ ] 场景③ 多模块并行：画布并行→汇聚全链路；三份契约签收
- [ ] 场景④ 注入式 QA 失败：Repair Generator 全新上下文；报告只带 diff+失败断言+最小复现
- [ ] 场景⑤ 所有权冲突：OWNERSHIP_CONFLICT → ⚖ 决策 → 暂停/恢复
- [ ] 破坏性操作：引擎拦截 PAUSED + 胶囊红点
- [ ] V7 token 对比：场景③ vs 改造前同规模任务，降幅 ≥ 20%（数字记录在下方）
- [ ] Safari 全流程：无崩溃、无渲染异常

## V7 数字记录

| 任务 | 改造前 tokens | 改造后 tokens | 降幅 |
| --- | --- | --- | --- |
| （待记录） | | | |

## 遗留观察项

- （待记录）
