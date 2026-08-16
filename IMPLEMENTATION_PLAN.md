# 软件公司式 Harness —— 诊断结论与实施计划（DSH 版）

## 一、诊断结论：系统确实没有装好

上一会话（2025-08-15 14:38）收到你的完整规格后，只做了 4 次 cordis 框架检查调用就中断了，
**没有产出任何文件、任何结果**。证据如下：

| 检查点 | 预期（规格 §5） | 实际状态 |
|---|---|---|
| 工作区 `software-company-harness` | 插件源码、任务文件 | **完全为空** |
| `~/.dsh/profiles/web/cordis.yml` | 注册软件公司插件 | 空列表 `[]`（只有脚手架注释） |
| `~/.dsh/profiles/web/cordis.patch.yml` | 用户补丁层 | 空列表 `[]` |
| `~/.dsh/.agent-presets/` | 14 个 company-* 角色 | **不存在** |
| `~/.dsh/skills/` | software-company 技能 | **不存在** |
| `~/.codex/agents/` | company-*.toml（规格原文目标） | **不存在** |
| `.company-harness/` 任务目录 | 按任务建档 | **不存在** |

结论：**规格是完整的，但实现一次都没有落地。** 不是"装好了不输出"，而是压根没有装。

## 二、环境映射：规格写的 ~/.codex，但当前环境是 DSH

你的规格 §5 按 Codex CLI 布局写（`~/.codex/agents/*.toml`），而当前系统是
**DeepSeek Harness（DSH）**，它的插件框架叫 **cordis**（`docs/cordis-primer.zh.md`）。
上一会话已为此建了空 profile。正确的安装方式是把规格原样映射到 DSH：

| 规格条目 | DSH 原生落地位置 |
|---|---|
| `~/.codex/agents/company-*.toml`（14 角色） | `~/.dsh/.agent-presets/company-*/agent.cordis.yml` |
| `~/.codex/skills/software-company/` | `~/.dsh/skills/software-company/SKILL.md` |
| 全局制度、状态机、合同、派工逻辑 | 一个 cordis 插件（源码在本工作区，经 `cordis.patch.yml` 注册） |
| `<project>/.company-harness/tasks/...` | **不变**，普通文件 + Git |
| `<project>-company-worktrees/` | **不变**，git worktree |
| 角色独立上下文、模型/reasoning 锁定 | `ctx.subagents` 进程内派工 + 每次派工覆盖 model / model_reasoning_effort |

## 三、实施阶段（批准后执行）

### 阶段 1：工作区骨架
- `git init`；`package.json`（私有包 `software-company-harness`）、`pnpm-workspace.yaml`
- 目录：`plugins/`（cordis 插件）、`skills/software-company/`、`presets/`（14 角色）、`tests/`

### 阶段 2：全局制度层（对应规格 §5.1、§6）
- 14 个 agent preset，每个 `agent.cordis.yml` 显式锁定：
  - Coordinator：`deepseek-v4-pro` / `max`
  - 其余 13 个角色：按规格表（Pro 或 Flash）/ `high`
- `skills/software-company/SKILL.md`：操作手册（分类、合同、交接、验收、成本护栏）

### 阶段 3：公司引擎插件（对应规格 §7-§18）
cordis 插件提供服务和 Coordinator 工具：
- `company.state`：RUN_STATE.json 状态机（INTAKE → … → RELEASED / PAUSED）
- `company.classify`：五维分类（歧义/模块跨度/状态数据/外部集成/失败风险）
- `company.contracts`：SPRINT_CONTRACT 冻结与签署，冻结后不可改
- `company.ownership`：WORK_OWNERSHIP 文件所有权、共享表面只允许 Integrator
- `company.dispatch`：按角色派子代理，并发上限 1/3/4，互斥 worktree
- `company.repair`：FAIL 硬路由 → 全新 Repair Generator（2 次修复 → 1 次重规划 → PAUSED）
- `company.ledger`：COST_LEDGER 记录真实可用用量，不可用就写"不可获得"
- 工具：`company_status / company_classify / company_freeze_contract / company_sign / company_spawn_role / company_record_evidence / company_decide / company_repair / company_pause / company_resume`

### 阶段 4：接线安装
- `~/.dsh/profiles/web/cordis.patch.yml` 注册插件与技能
- `~/.dsh/.agent-presets/company-*` 与 `~/.dsh/skills/software-company/` 落盘
- 验证发现：DSH 无需重启即可发现新 preset（discovery 每次重读）

### 阶段 5：系统验收（规格 §20 的 H-01…H-13）
隔离样例项目跑 5 个场景：小型 UI 修改、中型持久化功能、多模块新功能、
注入式 QA 失败、并发文件所有权冲突；另用一个破坏性操作样例验证自动暂停。

## 四、需要你拍板的决策点

1. **安装目标**：DSH 原生（`~/.dsh`，推荐，当前环境即 DSH）还是照规格字面装到 `~/.codex`（供 Codex CLI 用）？
2. **实现粒度**：先交付"完整骨架 + 核心引擎 + 5 场景验收"（推荐），还是逐阶段确认？
3. 全局层写入 `~/.dsh` 属于工作区外写入，执行时需要你授权（规格 §21 要求的审批点）。
