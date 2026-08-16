# Work Ownership — TASK-20260815-001

> 唯一负责人：Coordinator。并行写入的前提：Sprint Contract 已签署、文件集合互不交叉、每个部门独立 worktree/分支、接口与数据结构已冻结、已指定唯一 Integrator。
> 共享表面（依赖锁文件、公共类型、数据库迁移、CI、部署配置、共享样式令牌、跨模块生成文件）只能由 Integrator 串行修改。
> 发现冲突：停止后进入者，保留现场不自动回滚，Coordinator 标记 OWNERSHIP_CONFLICT。

## Claims (JSON)
```json
[]
```
