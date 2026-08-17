# 画布出厂动效 + 默认锁定当前会话（方案 2）设计

日期：2026-08-17
状态：已批准（用户选定方案 2）
范围：`presets/software-company/packages/company-r2/`（web/canvas.html、web/canvas.js、host.js）

## 1. 背景与问题

1. 画布每次打开时，若 URL 无 `?scope=` 且父窗口无法匹配到当前会话，`STATE.scope` 为 null，数据口径落入「全部项目合并」：别的会话的任务 chip、部门调用卡、token 会直接出现在新打开的界面里。
2. 组织视图的「待命·调用×N」计数（`everCallCounts`）与头部 token 总量刻意在全项目口径下统计（`canvasSnapshot` 中在 scope 过滤之前计算），即使已锁定 scope 也会显示别的会话的历史。
3. canvas.html 顶栏写死了演示数字（`3 项目 · 2 工作中 · 1.24M · 🔴 1`、`今日 +86k`），空数据时会被误读成真实数据。

目标：**每次打开画布先播「出厂动效」，动效期间定位当前会话；动效结束后只加载当前会话的数据**。别的会话的数据不再默认可见，但保留「🏢 全部」作为手动入口。

## 2. 打开时间线（新行为）

```
打开画布
  │ 0ms      播出厂动效：暗场 + 🏢 呼吸 logo + 骨架线 + 「公司启动中 · 正在定位当前会话…」
  │          期间只定位当前会话，不渲染任何任务/派工/事件/用量数据
  │ ~1200ms   动效淡出；开始拉取数据并渐入渲染（仅当前会话）
  ▼ 完成      无任何存活会话时：停在「出厂空态」——14 张灰色底卡 + 提示文案
```

- 动效只在**每次打开画布**时播一次；会话切换（侧栏点击、面板 postMessage）保持即时切换，不重播。
- 数据请求在动效结束后才发起（符合「时间后你读取加载」的预期），避免动效期间闪出旧数据。

## 3. 改动点 A：canvas.html —— 出厂动效覆盖层

- 新增 `<div id="bootOverlay">`，覆盖 `.app` 区域：
  - 暗背景 + 🏢 logo 呼吸动画；
  - 三行骨架线（任务条 / 画布块 / 侧栏块）占位；
  - 文案「公司启动中 · 正在定位当前会话…」。
- 顶栏 cap-strip 的写死演示数字不再裸展示：
  - 动效期间 `#capTok`、`#tokTotal` 显示 `-`，cap-pill 的静态文案（`3 项目 · 2 工作中 · 🔴 1`）与「今日 +86k」隐藏；
  - ready 后按真实数据渲染；空态时 cap-pill 显示 `🏢 Company · 0 项目 · ⚙ 0 工作中 · ⚡ 0`。
- `#nd-placeholder` 出厂空态文案改为：「🏢 新公司 · 还没有会话（在对话里选 Software Company 模式并 company_start 后自动聚焦）」。

## 4. 改动点 B：canvas.js —— boot 状态机 + 默认 scope 策略

### 4.1 boot 状态机

- 新增 `STATE.boot = { phase: 'booting' | 'ready', minUntil: number }`。
- `booting` 期间：
  - 抑制 `renderOrg()` / `renderChips()` / `renderCallCards()` / token ticker 等一切数据渲染；
  - 不发起 `/company-api/events`、`/company-api/canvas` 请求；
  - 允许发起 `/company-api/sessions`（只读会话清单，用于定位当前会话）。
- 到点切换 `ready`：`max(minUntil, scope 确定时刻)`，上限硬性 2.5s 强制 ready（防卡死）。
- 动效淡出（CSS transition）与首轮 `poll()` 同时进行，数据渐入。

### 4.2 默认 scope 决策（替换「无 scope 即全部」）

按优先级：

1. URL `?scope=`（面板/独立窗口带参）→ 直接使用；
2. 父窗口 `postMessage('company-scope')`（现有逻辑，保留）；
3. 父窗口侧栏标题匹配（现有 `autoDetectScope`，保留）；
4. 以上均无 → 兜底到会话清单里**最近的存活会话**（依赖 5.1 的 `live` 标记；多个存活会话取 taskCount 最大者，taskCount 相同时取清单顺序）；
5. 没有任何存活会话（首页打开）→ 进入出厂空态，**不落入「全部」**。

- 「🏢 全部」chip 保留为**手动**入口：用户点击后 `STATE.scope = null`，恢复全项目口径（现有 `__selectScope` 逻辑不变）。
- 会话切换保持即时：`autoDetectScope` / postMessage 处理器照旧，不触发 boot。

### 4.3 出厂空态（纯客户端，不改 API 的无 scope 语义）

- 新增 `STATE.empty = true`（boot 结束仍无任何存活会话时置位）。
- `empty` 状态下 `poll()` 只轮询 `/company-api/sessions`，**不发** `/company-api/events` 与 `/company-api/canvas` 请求；画布本地渲染 14 张灰色底卡 + 空态文案。
- 当 sessions 轮询发现新出现存活会话时，按 4.2 自动聚焦并清除 `empty`，恢复正常数据渲染。
- 用户手动点「🏢 全部」在空态下同样可用（显式选择全局视角），此时 `STATE.empty = false` 并按现有无 scope 请求取全量数据。

## 5. 改动点 C：host.js —— 数据口径随 scope

### 5.1 sessionsSnapshot 透出 live

- `sessionsSnapshot` 每行新增 `live: boolean`（内存中已有 `meta.live`，仅未透出）。
- 兼容性：只加字段，不改字段名。

### 5.2 canvasSnapshot 按 scope 统计

- 有 scope 时：
  - `everCallCounts` / `everCalledDepts` 改为按 scope 过滤后的派工统计（蓝色待命、调用×N 只反映本会话）；
  - `totalTokens` 返回该 scope 的总量；
  - 同时保留全项目口径字段：`everCallCountsAll`、`everCalledDeptsAll`、`totalTokensAll`，供「🏢 全部」视图使用。
- **无 scope 的请求语义不变**（仍是全项目口径，兼容旧客户端与「全部」视图）；出厂空态由客户端 4.3 实现，不依赖 API 返回空数据。

### 5.3 现有行为不变量

- 无 scope 的旧请求走全项目口径，字段兼容：新增字段仅附加，不改旧字段语义；canvas 按 `STATE.scope` 与 `STATE.empty` 选择读取。
- `eventsSnapshot` 已有 scope 过滤逻辑，不动。

## 6. 错误处理

- 动效期间引擎未挂载 / 请求失败：动效照常走完；结束后按现有 `showEngineDown` 逻辑显示横幅。
- boot 覆盖层硬上限 2.5s，超时强制 ready，保证界面不会停留在动画。
- 兜底 scope 匹配失败（会话清单为空且无任何信号）：进入出厂空态，不报错。

## 7. 测试

- **host.js 单测**（`company-r2/tests/`，沿用现有风格）：
  - scope 存在时 `everCallCounts` 只统计该 scope 的派工；
  - `everCallCountsAll` 保持全项目口径；
  - scope 存在时 `totalTokens` 为该 scope 总量；
  - 无 scope 请求语义不变（仍全项目）；
  - `sessionsSnapshot` 每行含 `live` 布尔。
- **画布 CDP 冒烟**（复用现有 headless Chrome + CDP 脚本方式）：
  1. 打开 `/company`：先见出厂动效，`~1.2s` 后数据渐入；
  2. 会话内打开（面板 iframe）：只见当前会话的任务 chip / 调用卡 / 待命状态；
  3. 首页打开：出厂空态 + 提示文案，无任何其他会话数据，且不请求 canvas/events 接口；
  4. 手动点「🏢 全部」：全项目口径恢复；
  5. 侧栏切换会话：即时跟随、不重播动效；
  6. 引擎未挂载：动效结束后显示既有横幅。

## 8. 不改的东西

流程视图 DAG、节点拖拽与布局复位、交接契约图标与抽屉、事件流侧栏、并发/审批/招聘面板、company-panel 自身的 auto-follow 逻辑——全部不动。

## 9. 风险与回滚

- 改动集中在 `canvas.html` / `canvas.js` / `host.js` 三处，`host.js` 的响应是**加字段 + 改统计口径**，对旧客户端兼容（旧字段仍在）。
- 若兜底「最近存活会话」在特定环境下误选（多会话并存），影响面仅为默认聚焦对象，用户可手动点 chip 纠正；必要时可关闭兜底只留 URL/面板信号。
