# deepseek-harness-software-OPC

适配 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的「软件公司模式」preset：把一次软件开发组织成一家真实运转的软件公司——需求、架构、编码、集成、验收、安全各由独立部门分工执行，而你作为公司总监，在可视化大画布上实时看进度、看调用、看 Token、做决策。

## 演示

![总监大画布演示动图](assets/demo-panel.gif)

**[▶ 观看高清演示视频（8s，MP4）](https://github.com/chenshijun900730-bit/deepseek-harness-software-OPC/releases/download/v0.1.0/demo-panel.mp4)**

[![总监大画布](assets/panel-overview.png)](assets/panel-overview.png)

> 总监大画布：真实数据 2s 增量拉取 · 节点可拖动连线跟随 · 悬停看信息卡 · 画布上直接审批/决策

## 为什么需要它

长对话里让一个 agent 从头做到尾，上下文会不断膨胀：历史决定、报错日志、无关讨论混在一起，形成「噪点」。噪点越积越多，agent 对目标的理解开始漂移——做到后面忘了最初要什么，或者被中途细节带偏方向。

软件公司模式用**组织结构**对抗噪点：

- **需求冻结**：需求先固化为可验收的产品规格与 Sprint 合同，白纸黑字，后续所有部门只对合同负责，不靠「记忆」维持目标。
- **部门分工**：每个部门拿到的是干净的局部上下文，只带自己的职责、自己的文件、自己的验收标准进场，不继承别人的闲聊与噪音。
- **验收独立**：编码的人不验收，验收的人不编码；Sprint 评审与最终验收由独立角色在干净环境完成。
- **失败硬路由**：验收不过不走「再聊聊」，直接进入修复路由，由专职 Repair Generator 拿着失败证据返工。

## 它是一家怎样的公司

13 个常设角色 + 1 个失败触发的修复角色，分属不同部门，各司其职：

| 部门职能 | 角色 | 干什么 |
| --- | --- | --- |
| 总控 | Coordinator 项目总控 | 分类、组队、派工、状态推进、冲突裁决 |
| 产品 | Planner 产品经理 | 产品蓝图、用户故事、范围与非目标、Sprint 路线 |
| 架构 | 架构负责人 | 模块边界、接口、数据结构、依赖顺序 |
| 研发 | Generator 主程序员 / 部门程序员 | 前端、后端、数据等独立模块分别实现，互不越界 |
| 集成 | Integrator 集成负责人 | 合并提交、处理共享表面、全量回归 |
| 质量 | Sprint Evaluator / 最终验收负责人 | 对单轮 Sprint 与跨 Sprint 端到端签发 PASS/FAIL |
| 安全 | 安全/数据迁移评审 | 权限、支付、隐私、迁移专项检查 |
| 支援 | Explorer 调查员 / QA 执行员 / Mechanical Worker / Recorder | 只读调查、测试取证、批量机械操作、记录 |

角色按职责分配两档模型（`deepseek-v4-pro` / `deepseek-v4-flash`）与推理等级（max/high/medium/low），复杂度越高，思考越深。

## 总监看板

面板（点 Web UI 右上角 🏢 Company 进入）为总监提供：

- **总监大画布**：部门与任务以节点卡片呈现，连线即派工关系；节点可拖动，连线跟随。
- **实时增量**：真实数据 2s 增量拉取，流程进度、子代理调用、Token 消耗实时更新。
- **调用可追溯**：每次子代理调用一条记录卡（时间、Trace、Token），可展开回溯。
- **风险分级**：任务按 high-risk / medium 等级着色，一眼锁定需要盯的对象。
- **画布上决策**：悬停看信息卡，直接在画布上审批与决策。
- **并发管控**：总监可调并发上限（复杂任务默认 2），控制节奏与成本。

## 目录结构

```
presets/software-company/   preset 本体
├── agent.cordis.yml        agent 平面组合（persona、指令、工具）
├── preset.yml              preset 元信息
├── roles/                  角色库（14 角色，含模型与推理等级）
└── packages/
    ├── company-r2/         公司流程引擎（合同、派工、事件、用量）+ 画布
    └── company-panel/      总监面板宿主挂载
assets/                     演示视频与面板截图
```

## 快速开始

要求 Node.js `^22.19.0 || >=24.0.0`，需要一个可访问 `deepseek-v4-pro` / `deepseek-v4-flash` 的 DeepSeek API Key。

```bash
# 0. 获取本仓库
git clone https://github.com/chenshijun900730-bit/deepseek-harness-software-OPC.git
cd deepseek-harness-software-OPC

# 1. 启动 DSH 宿主（默认 127.0.0.1:3080；端口被占用时加 --port 14080）
npx @deepseek-ai/dsh web

# 2. 安装 preset
cp -R presets/software-company ~/.dsh/.agent-presets/software-company

# 3. 配置默认 preset（~/.dsh/settings.yaml）
# agent-presets:
#   default: software-company

# 4. 挂载总监面板（必做，否则右上角不会出现 🏢 Company 胶囊且无报错提示）
mkdir -p ~/.dsh/profiles/web/node_modules
ln -s ~/.dsh/.agent-presets/software-company/packages/company-panel \
  ~/.dsh/profiles/web/node_modules/software-company-panel
# 并在 ~/.dsh/profiles/web/cordis.patch.yml 写入（文件不存在则创建）：
# - insert:
#     - id: company-panel
#       name: software-company-panel

# 5. 重启 DSH，在 Web UI 设置里填入 API Key，点右上角 🏢 Company
```

完整步骤（含全局安装备选路径、端口冲突处理、npm allow-scripts 警告说明、常见报错排查）见 [INSTALL.md](INSTALL.md)。

## License

MIT
