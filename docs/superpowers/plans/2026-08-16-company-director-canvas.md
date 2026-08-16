# 软件公司 Harness v2 · 总监可视化串并联开发模式 Implementation Plan

> **执行偏差记录（2026-08-16）**：
> 1. `company_run_sprint` v1 实现为「批量派工计划生成」（不 host 直派子代理）：subagents 服务契约 `start(name, request)` 需要 live parent Agent，host 侧直派风险高，实际派工仍由 Coordinator 按计划用 subagent 工具执行（可并行）。host 直派留作 P3 增强项。
> 2. `adjudicate` v1 为降级路径：发 `adjudication.started` 事件 + 返回裁决指引，由 Coordinator 下一回合以 max reasoning 子代理裁决后经 `company_decide` 写回。
> 3. Task 6 测试期望修正：cubicMid t=0.5 的 y 期望 7.5（标准三次贝塞尔公式），非 5。
> 4. 测试脚本 glob：Node 23 需 `node --test tests/*.test.js`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `software-company` preset 从「线性黑箱流水线」升级为「串并联可视化公司」：DAG 流程引擎 + 事件流 + 交接契约 + 总监大画布（可拖动/悬停/审批/决策）+ 招聘部门，并落地五刀 token 优化。

**Architecture:** 引擎（host 状态机，唯一写入者）把状态/事件/契约/台账写进 `.company-harness/` 文件；新增 6 个纯函数 lib 模块（`node --test` 单测）被 host.js 引用；画布页由 host `webServer` 在 `/company` 路由提供，每 2s 增量拉取事件流 + 前端线性补间，渲染零 token。浏览器端连线/补间数学放 `lib/geometry.js`，Node 与浏览器共用。

**Tech Stack:** Node ≥ 20（ESM）、`node:test`、零依赖浏览器原生 JS、DSH cordis 插件（host 包 `company-r2`）、既有 `/company-api/*` 路由体系。

**Spec:** `docs/superpowers/specs/2026-08-16-company-director-canvas-design.md`

**目录约定（重要，先读）：**
- **仓库镜像（开发主阵地，git 跟踪）**：`presets/software-company/**` —— 本计划所有编辑、测试、提交都发生在这里
- **真实部署（DSH 实际加载）**：`~/.dsh/.agent-presets/software-company/**` —— 由同步步骤 `rsync -a presets/software-company/ ~/.dsh/.agent-presets/software-company/` 部署；**写 ~/.dsh 需要用户授权**（本会话文件策略为 workspace-write）
- **生效机制**：host.js 修改后需**新开会话**（或重启 DSH Web 服务）才被重新导入；client 面板刷新页面即可
- 同步时机：只在「带 live 冒烟」的任务里同步（Task 8/15/19/21/25），其余任务改仓库即可

**关键约束（写死，任何任务不得违反）：**
1. `client.js` 末尾 `__ModuleLoader__.load` 注册块**保持原样**（HANDOVER.md 第 1 条）
2. 包目录**不改名**（幽灵插件教训）；只改文件内容，rsync 只覆盖内容
3. 旧 4 个任务（TASK-20260815-001…004）必须保持可读（V6）；新字段增量添加
4. 真实派工机制 = Coordinator 调用 subagent 工具（host.js 无 spawn 代码，只有 `subagent/start|end` 事件与 `agentLog`）；引擎侧并发是「核算 + 事件 + 提示」，不做硬拦截
5. UI 视觉基线 = `.superpowers/brainstorm-stable/content/s03-final-layout-v2.html`（用户定稿确认的演示）

---

# Part 0 · 镜像初始化

## Task 0: 把 live preset 镜像进仓库

**Files:**
- Create: `presets/software-company/**`（镜像副本）

- [ ] **Step 1: 复制**

```bash
mkdir -p presets && rsync -a ~/.dsh/.agent-presets/software-company/ presets/software-company/
find presets/software-company -type f | wc -l
```
Expected: 文件数 ≈ 11（agent.cordis.yml、preset.yml、roles×2、packages/company-r2×5、packages/company-panel×4）

- [ ] **Step 2: 确认镜像可单测**

Run: `cd presets/software-company/packages/company-r2 && node -e "import('./package.json',{assert:{type:'json'}}).then(m=>console.log(m.default.type))"`
Expected: `module`

- [ ] **Step 3: 提交**

```bash
git add presets/ && git commit -m "chore: 镜像 live software-company preset 进入仓库"
```

> 之后所有任务中的路径 `packages/company-r2/...` 均指仓库内 `presets/software-company/packages/company-r2/...`；同步命令简写为 `sync`（见上）。

---

# Part P0 · 引擎

## Task 1: lib/flow.js —— DAG 流程模板与校验

**Files:**
- Create: `presets/software-company/packages/company-r2/lib/flow.js`
- Test: `presets/software-company/packages/company-r2/tests/flow.test.js`

- [ ] **Step 1: 写失败测试**（内容如下，一字不差）

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOW_TEMPLATES, validateFlow, readyNodes, adjustFlow, STAGES_LEGACY } from '../lib/flow.js'

test('complex 模板含三路并行且汇聚集成', () => {
  const f = FLOW_TEMPLATES.complex
  const ids = f.nodes.map((n) => n.id)
  assert.ok(ids.includes('fe') && ids.includes('be') && ids.includes('data'))
  const inte = f.nodes.find((n) => n.id === 'integrate')
  assert.deepEqual(inte.needs.slice().sort(), ['be', 'data', 'fe'])
})

test('validateFlow 拒绝未知依赖与重复 id', () => {
  assert.equal(validateFlow({ nodes: [{ id: 'a', dept: 'x', needs: ['ghost'] }] }).length, 1)
  assert.equal(validateFlow({ nodes: [{ id: 'a', dept: 'x' }, { id: 'a', dept: 'y' }] }).length, 1)
  assert.equal(validateFlow(FLOW_TEMPLATES.small).length, 0)
})

test('readyNodes 按依赖就绪', () => {
  const f = FLOW_TEMPLATES.complex
  assert.deepEqual(readyNodes(f, new Set(['plan'])), ['arch'])
  assert.deepEqual(readyNodes(f, new Set(['plan', 'arch'])).sort(), ['be', 'data', 'fe'])
  assert.deepEqual(readyNodes(f, new Set(['plan', 'arch', 'fe', 'be', 'data'])), ['integrate'])
})

test('adjustFlow insert 与 skip 留痕', () => {
  let f = adjustFlow(FLOW_TEMPLATES.small, { op: 'insert', after: 'build', node: { id: 'lint', dept: 'qa-runner', title: 'Lint 门禁' } })
  const lint = f.flow.nodes.find((n) => n.id === 'lint')
  assert.deepEqual(lint.needs, ['build'])
  assert.equal(f.flow.adjustments.length, 1)
  f = adjustFlow(f.flow, { op: 'skip', id: 'lint' })
  assert.equal(f.flow.adjustments.length, 2)
  assert.deepEqual(f.flow.adjustments[1].op, 'skip')
})

test('STAGES_LEGACY 17 步用于旧任务回退', () => {
  assert.equal(STAGES_LEGACY.length, 17)
  assert.equal(STAGES_LEGACY[0], 'INTAKE')
  assert.equal(STAGES_LEGACY[STAGES_LEGACY.length - 1], 'RELEASED')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd presets/software-company/packages/company-r2 && node --test tests/flow.test.js`
Expected: FAIL（`Cannot find module '../lib/flow.js'`）

- [ ] **Step 3: 最小实现**（`lib/flow.js`）

```js
// 纯函数流程模块：DAG 模板 / 校验 / 就绪计算 / 总监调整（全部无 IO，可单测）
export const STAGES_LEGACY = [
  'INTAKE', 'CLASSIFIED', 'DISCOVERY', 'PRODUCT_PLANNED', 'WAITING_INITIAL_APPROVAL',
  'SPRINT_DRAFTING', 'CONTRACT_REVIEW', 'CONTRACT_SIGNED', 'IMPLEMENTING', 'SELF_CHECK',
  'INTEGRATING', 'QA_RUNNING', 'SPRINT_PASSED', 'REPAIRING', 'REPLANNING',
  'FINAL_E2E', 'RELEASED',
]

const N = (id, dept, title, needs) => ({ id, dept, title: title || id, needs: needs || [] })

export const FLOW_TEMPLATES = {
  small: {
    nodes: [
      N('plan', 'planner', '产品规划'),
      N('build', 'generator', '实现'),
      N('verify', 'sprint-evaluator', '确定性门禁', ['build']),
      N('release', 'coordinator', '发布', ['verify']),
    ],
  },
  medium: {
    nodes: [
      N('plan', 'planner', '产品规划'),
      N('explore', 'explorer', '仓库调查'),
      N('build', 'generator', '实现', ['plan', 'explore']),
      N('review', 'sprint-evaluator', '评审', ['build']),
      N('qa', 'qa-runner', 'QA', ['build']),
      N('release', 'coordinator', '发布', ['review', 'qa']),
    ],
  },
  complex: {
    nodes: [
      N('plan', 'planner', '产品规划'),
      N('arch', 'architect', '架构设计', ['plan']),
      N('fe', 'department-generator', '前端部', ['arch']),
      N('be', 'department-generator', '后端部', ['arch']),
      N('data', 'department-generator', '数据部', ['arch']),
      N('integrate', 'integrator', '集成', ['fe', 'be', 'data']),
      N('qa', 'qa-runner', 'QA', ['integrate']),
      N('final', 'final-evaluator', '终验', ['qa']),
      N('release', 'coordinator', '发布', ['final']),
    ],
  },
  'high-risk': {
    nodes: [
      N('plan', 'planner', '产品规划'),
      N('arch', 'architect', '架构设计', ['plan']),
      N('fe', 'department-generator', '前端部', ['arch']),
      N('be', 'department-generator', '后端部', ['arch']),
      N('data', 'department-generator', '数据部', ['arch']),
      N('integrate', 'integrator', '集成', ['fe', 'be', 'data']),
      N('qa', 'qa-runner', 'QA', ['integrate']),
      N('security', 'security-reviewer', '安全评审', ['integrate']),
      N('final', 'final-evaluator', '终验', ['qa', 'security']),
      N('release', 'coordinator', '发布', ['final']),
    ],
  },
}

export function validateFlow(flow) {
  const errs = []
  if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length === 0) return ['nodes 缺失或为空']
  const ids = new Set()
  for (const n of flow.nodes) {
    if (ids.has(n.id)) errs.push('重复节点 id: ' + n.id)
    ids.add(n.id)
  }
  for (const n of flow.nodes) {
    for (const need of n.needs || []) {
      if (!ids.has(need)) errs.push('节点 ' + n.id + ' 依赖不存在的 ' + need)
    }
    if (n.needs && n.needs.includes(n.id)) errs.push('节点 ' + n.id + ' 依赖自身')
  }
  return errs
}

export function readyNodes(flow, done) {
  return flow.nodes
    .filter((n) => !done.has(n.id) && !n.skipped && (n.needs || []).every((x) => done.has(x)))
    .map((n) => n.id)
}

export function adjustFlow(flow, op) {
  const next = structuredClone(flow)
  next.adjustments = (next.adjustments || []).concat([{ op: op.op, at: new Date().toISOString() }])
  if (op.op === 'insert' || op.op === 'addParallel') {
    const anchor = next.nodes.find((n) => n.id === op.after)
    if (!anchor) throw new Error('锚点不存在: ' + op.after)
    const node = { ...op.node, needs: op.op === 'insert' ? [op.after] : (op.after ? [op.after] : []) }
    next.nodes.push(node)
  } else if (op.op === 'skip') {
    const target = next.nodes.find((n) => n.id === op.id)
    if (!target) throw new Error('节点不存在: ' + op.id)
    target.skipped = true
    for (const n of next.nodes) {
      if ((n.needs || []).includes(op.id)) {
        n.needs = n.needs.filter((x) => x !== op.id).concat(target.needs || [])
      }
    }
  } else {
    throw new Error('未知操作: ' + op.op)
  }
  const errs = validateFlow(next)
  if (errs.length) throw new Error('调整后流程非法: ' + errs.join('; '))
  return { flow: next, changed: true }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd presets/software-company/packages/company-r2 && node --test tests/flow.test.js`
Expected: PASS（5/5）

- [ ] **Step 5: 提交**

```bash
git add presets/software-company/packages/company-r2/lib/flow.js presets/software-company/packages/company-r2/tests/flow.test.js
git commit -m "feat(engine): DAG 流程模板/校验/就绪/调整纯函数模块"
```

## Task 2: lib/events.js —— 事件流

**Files:**
- Create: `presets/software-company/packages/company-r2/lib/events.js`
- Test: `presets/software-company/packages/company-r2/tests/events.test.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEventsFile, appendEvent, readSince } from '../lib/events.js'

test('追加事件带递增 seq，readSince 增量返回', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'))
  const file = createEventsFile(dir)
  appendEvent(file, { type: 'task.created', taskId: 'T1' })
  appendEvent(file, { type: 'stage.started', taskId: 'T1', stage: 'arch' })
  const all = readSince(file, 0)
  assert.equal(all.length, 2)
  assert.equal(all[0].seq, 1)
  assert.equal(all[1].seq, 2)
  const inc = readSince(file, 1)
  assert.equal(inc.length, 1)
  assert.equal(inc[0].type, 'stage.started')
})

test('空文件读取出空数组', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'))
  const file = createEventsFile(dir)
  assert.deepEqual(readSince(file, 0), [])
})
```

- [ ] **Step 2: 运行确认失败** → FAIL
- [ ] **Step 3: 最小实现**（`lib/events.js`）

```js
// 事件流：单进程追加（host 引擎是唯一写入者），画布按 seq 增量拉取
import fs from 'node:fs'
import path from 'node:path'

export function createEventsFile(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'events.jsonl')
}

let seqCounter = 0

export function appendEvent(file, event) {
  seqCounter += 1
  const rec = { seq: seqCounter, ts: new Date().toISOString(), ...event }
  fs.appendFileSync(file, JSON.stringify(rec) + '\n')
  return rec
}

export function readSince(file, afterSeq) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line)
      if (rec.seq > afterSeq) out.push(rec)
    } catch { /* 半行写入忽略 */ }
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: 提交**

```bash
git add presets/software-company/packages/company-r2/lib/events.js presets/software-company/packages/company-r2/tests/events.test.js
git commit -m "feat(engine): 事件流追加与 seq 增量读取"
```

## Task 3: lib/contract.js —— 交接契约三件套

**Files:**
- Create: `presets/software-company/packages/company-r2/lib/contract.js`
- Test: `presets/software-company/packages/company-r2/tests/contract.test.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContract, validateContract, signContract, renderContractMarkdown, assertionBadges } from '../lib/contract.js'

test('buildContract 生成三件套并校验', () => {
  const c = buildContract({
    from: 'arch', to: 'fe', modules: ['web/', 'api/', 'data/'],
    apiSignatures: [{ path: 'GET /api/todos', shape: 'Todo[]', owner: 'api' }],
    nonGoals: ['不做用户系统'], assertions: { tests: '4/4', lint: true, coverage: '88%', build: true },
  })
  assert.equal(validateContract(c).length, 0)
  assert.match(renderContractMarkdown(c), /web\//)
  assert.match(renderContractMarkdown(c), /GET \/api\/todos/)
  assert.match(assertionBadges(c.assertions), /✅ 测试 4\/4/)
})

test('validateContract 拒绝缺字段与未知 owner', () => {
  assert.ok(validateContract({}).length > 0)
  const bad = buildContract({ from: 'x', to: 'y', modules: [], apiSignatures: [{ path: 'a', shape: 'b', owner: 'ghost' }], nonGoals: [], assertions: {} })
  assert.equal(validateContract(bad).length, 1)
})

test('signContract 追加签收且不改原对象', () => {
  const c = buildContract({ from: 'arch', to: 'fe', modules: ['a'], apiSignatures: [], nonGoals: [], assertions: {} })
  const signed = signContract(c, 'fe', '2026-08-16T00:00:00Z')
  assert.equal(c.signatures.length, 0)
  assert.equal(signed.signatures.length, 1)
  assert.equal(signed.signatures[0].by, 'fe')
})
```

- [ ] **Step 2: 运行确认失败** → FAIL
- [ ] **Step 3: 最小实现**（`lib/contract.js`）

```js
// 交接契约三件套：模块图 + 类型化 API 签名 + 非目标清单（替代散文 HANDOFF）
const OWNERS = ['web', 'api', 'data', 'integrator', 'generator', 'department-generator']

export function buildContract({ from, to, modules, apiSignatures, nonGoals, assertions }) {
  return {
    version: 1, from, to, issuedAt: new Date().toISOString(),
    modules: modules || [],
    apiSignatures: apiSignatures || [],
    nonGoals: nonGoals || [],
    assertions: assertions || {},
    signatures: [],
  }
}

export function validateContract(c) {
  const errs = []
  if (!c || typeof c !== 'object') return ['contract 缺失']
  if (!c.from || !c.to) errs.push('from/to 必填')
  if (!Array.isArray(c.modules) || !Array.isArray(c.apiSignatures) || !Array.isArray(c.nonGoals)) errs.push('modules/apiSignatures/nonGoals 必须是数组')
  for (const s of c.apiSignatures || []) {
    if (!s.path || !s.shape || !s.owner) errs.push('签名缺字段: ' + JSON.stringify(s))
    else if (!OWNERS.includes(s.owner)) errs.push('未知 owner: ' + s.owner)
  }
  return errs
}

export function signContract(c, by, at) {
  const next = structuredClone(c)
  next.signatures = (next.signatures || []).concat([{ by, at: at || new Date().toISOString() }])
  return next
}

export function renderContractMarkdown(c) {
  const mods = c.modules.map((m) => '- ' + m).join('\n')
  const sigs = c.apiSignatures.map((s) => '- `' + s.path + '` → ' + s.shape + '（owner: ' + s.owner + '）').join('\n')
  const ngs = c.nonGoals.map((n) => '- ' + n).join('\n') || '- （无）'
  const sigLine = (c.signatures || []).map((s) => s.by + ' @ ' + s.at).join('，') || '未签收'
  return [
    '# 交接契约：' + c.from + ' → ' + c.to,
    '签发：' + c.issuedAt + ' · 签收：' + sigLine,
    '## 1. 模块图', '```mermaid', 'graph TD', mods, '```',
    '## 2. 类型化 API 签名', sigs,
    '## 3. 非目标清单', ngs,
    '## 4. 确定性断言', assertionBadges(c.assertions),
  ].join('\n')
}

export function assertionBadges(a) {
  if (!a || Object.keys(a).length === 0) return '（暂无）'
  const parts = []
  if (a.tests) parts.push('✅ 测试 ' + a.tests)
  if (a.lint) parts.push('✅ lint')
  if (a.coverage) parts.push('✅ 覆盖率 ' + a.coverage)
  if (a.build) parts.push('✅ 构建通过')
  return parts.join(' · ') || '（暂无）'
}
```

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: 提交**

```bash
git add presets/software-company/packages/company-r2/lib/contract.js presets/software-company/packages/company-r2/tests/contract.test.js
git commit -m "feat(engine): 交接契约三件套构建/校验/签收"
```

## Task 4: lib/usage.js —— token 按部门归属

**Files:**
- Create: `presets/software-company/packages/company-r2/lib/usage.js`
- Test: `presets/software-company/packages/company-r2/tests/usage.test.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { attributeUsage, aggregateByDepartment } from '../lib/usage.js'

const dispatches = [
  { sessionId: 's1', taskId: 'T1', department: 'be' },
  { sessionId: 's2', taskId: 'T1', department: 'fe' },
  { sessionId: 's3', taskId: 'T2', department: 'be' },
]
const rows = [
  { id: 's1', totalTokens: 1000 },
  { id: 's2', totalTokens: 400 },
  { id: 's3', totalTokens: 600 },
  { id: 's9', totalTokens: 9999 },
]

test('归属与聚合', () => {
  const attr = attributeUsage(rows, dispatches)
  assert.equal(attr.length, 3)
  const agg = aggregateByDepartment(attr)
  assert.equal(agg.be.totalTokens, 1600)
  assert.equal(agg.fe.totalTokens, 400)
  assert.equal(agg.be.rank, 1)
  assert.equal(agg.fe.rank, 2)
})

test('聚合按任务切片', () => {
  const agg = aggregateByDepartment(attributeUsage(rows, dispatches), 'T2')
  assert.equal(agg.be.totalTokens, 600)
  assert.equal(agg.fe, undefined)
})
```

- [ ] **Step 2: 运行确认失败** → FAIL
- [ ] **Step 3: 最小实现**（`lib/usage.js`）

```js
// token 归属：tokenMeter 行 × 派工记录 → 部门聚合（估算处由调用方标注）
export function attributeUsage(rows, dispatches) {
  const bySession = new Map(dispatches.map((d) => [d.sessionId, d]))
  const out = []
  for (const r of rows || []) {
    const d = bySession.get(r.id)
    if (!d) continue
    out.push({ taskId: d.taskId, department: d.department, totalTokens: r.totalTokens || 0, sessionId: r.id })
  }
  return out
}

export function aggregateByDepartment(attributed, taskId) {
  const map = new Map()
  for (const a of attributed || []) {
    if (taskId && a.taskId !== taskId) continue
    const cur = map.get(a.department) || { department: a.department, totalTokens: 0, tasks: new Set() }
    cur.totalTokens += a.totalTokens
    cur.tasks.add(a.taskId)
    map.set(a.department, cur)
  }
  const list = [...map.values()].map((v) => ({ department: v.department, totalTokens: v.totalTokens, tasks: [...v.tasks] }))
  list.sort((x, y) => y.totalTokens - x.totalTokens)
  list.forEach((v, i) => { v.rank = i + 1 })
  return Object.fromEntries(list.map((v) => [v.department, v]))
}
```

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: 提交**

```bash
git add presets/software-company/packages/company-r2/lib/usage.js presets/software-company/packages/company-r2/tests/usage.test.js
git commit -m "feat(engine): token 按部门归属与聚合"
```

## Task 5: lib/hire.js —— 招聘/改造纯逻辑

**Files:**
- Create: `presets/software-company/packages/company-r2/lib/hire.js`
- Test: `presets/software-company/packages/company-r2/tests/hire.test.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEPT_ID_RE, validateHire, renderDeptPresetYml, mergeRole, undoRole } from '../lib/hire.js'

const STD = [{ id: 'generator', title: 'Generator', model: 'deepseek-v4-pro', reasoning: 'high' }]

test('validateHire 校验 id/模型/工具', () => {
  assert.equal(validateHire({ id: 'qa-auto', title: '自动化测试部', persona: '跑测试', model: 'deepseek-v4-flash', reasoning: 'medium', tools: ['bash'] }).length, 0)
  assert.ok(validateHire({ id: 'UPPER!!', title: 'x', persona: 'p', model: 'nope', reasoning: 'medium', tools: [] }).length >= 2)
})

test('renderDeptPresetYml 按工具集生成 preset 文本', () => {
  const yml = renderDeptPresetYml({ id: 'qa-auto', title: '自动化测试部', persona: '跑测试', model: 'deepseek-v4-flash', reasoning: 'medium', tools: ['bash', 'fs'] })
  assert.match(yml, /id: persona/)
  assert.match(yml, /id: tool-bash/)
  assert.match(yml, /id: tool-fs/)
  assert.doesNotMatch(yml, /id: tool-web/)
})

test('mergeRole 不得覆盖标准角色，undoRole 移除', () => {
  assert.throws(() => mergeRole(STD, { id: 'generator', title: 'x' }))
  const next = mergeRole(STD, { id: 'qa-auto', title: '自动化测试部' })
  assert.equal(next.length, 2)
  const back = undoRole(next, 'qa-auto')
  assert.equal(back.length, 1)
  assert.throws(() => undoRole(back, 'generator'))
})
```

- [ ] **Step 2: 运行确认失败** → FAIL
- [ ] **Step 3: 最小实现**（`lib/hire.js`）

```js
// 招聘/改造：校验、preset 文本生成、roles 合并与撤销（纯函数，无 IO）
export const DEPT_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/
export const VALID_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash']
export const VALID_REASONING = ['low', 'medium', 'high']
export const TOOL_ROWS = {
  bash: '- id: tool-bash\n  name: \'@deepseek-ai/dsh-tool-bash\'\n',
  fs: '- id: tool-fs\n  name: \'@deepseek-ai/dsh-tool-fs\'\n',
  search: '- id: tool-fs-search\n  name: \'@deepseek-ai/dsh-tool-fs-search\'\n',
  jobs: '- id: tool-jobs\n  name: \'@deepseek-ai/dsh-tool-jobs\'\n',
  subagent: '- id: tool-subagent\n  name: \'@deepseek-ai/dsh-tool-subagent\'\n  config:\n    provider: spawn\n    toolName: subagent\n    backgroundMode: continuable\n',
  web: '- id: tool-web\n  name: \'@deepseek-ai/dsh-tool-web\'\n  config:\n    fetch: false\n',
  ask: '- id: tool-ask-user\n  name: \'@deepseek-ai/dsh-tool-ask-user\'\n',
  todo: '- id: tool-todo\n  name: \'@deepseek-ai/dsh-tool-todo\'\n',
}

export function validateHire({ id, title, persona, model, reasoning, tools }) {
  const errs = []
  if (!DEPT_ID_RE.test(id || '')) errs.push('id 需匹配 [a-z0-9-]{2,32}')
  if (!title || !persona) errs.push('title/persona 必填')
  if (!VALID_MODELS.includes(model)) errs.push('model 必须 ' + VALID_MODELS.join('/'))
  if (!VALID_REASONING.includes(reasoning)) errs.push('reasoning 必须 ' + VALID_REASONING.join('/'))
  if (!Array.isArray(tools) || tools.some((t) => !TOOL_ROWS[t])) errs.push('tools 含未知项')
  return errs
}

export function renderDeptPresetYml({ id, title, persona, model, reasoning, tools }) {
  const toolRows = (tools || []).map((t) => TOOL_ROWS[t]).join('')
  return [
    '- id: persona',
    '  name: \'@deepseek-ai/dsh-persona\'',
    '  config:',
    '    text: >-',
    '      你是「' + title + '」部门（company-dept-' + id + '）的执行者。' + persona,
    '- id: agent-instructions',
    '  name: \'@deepseek-ai/dsh-agent-instructions\'',
    '  config:',
    '    maxBytes: 65536',
    toolRows,
  ].join('\n') + '\n'
}

export function mergeRole(roles, newRole) {
  if (roles.some((r) => r.id === newRole.id)) throw new Error('角色 id 已存在（标准角色不可覆盖）: ' + newRole.id)
  return roles.concat([{ ...newRole, source: 'hired' }])
}

export function undoRole(roles, id) {
  const target = roles.find((r) => r.id === id)
  if (!target) throw new Error('角色不存在: ' + id)
  if (target.source !== 'hired') throw new Error('标准角色不可撤销: ' + id)
  return roles.filter((r) => r.id !== id)
}
```

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: 提交**

```bash
git add presets/software-company/packages/company-r2/lib/hire.js presets/software-company/packages/company-r2/tests/hire.test.js
git commit -m "feat(engine): 招聘/改造部门纯逻辑"
```

## Task 6: lib/geometry.js —— 连线与补间数学

**Files:**
- Create: `presets/software-company/packages/company-r2/lib/geometry.js`
- Test: `presets/software-company/packages/company-r2/tests/geometry.test.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { lerp, straightMid, cubicMid, edgePath } from '../lib/geometry.js'

test('lerp 线性插值', () => {
  assert.equal(lerp(0, 100, 0.5), 50)
  assert.equal(lerp(10, 20, 0), 10)
})

test('cubicMid t=0.5 加权中点', () => {
  const m = cubicMid({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, 0.5)
  assert.equal(m.x, 5)
  assert.equal(m.y, 7.5)
})

test('edgePath 直线与贝塞尔', () => {
  assert.match(edgePath(0, 0, 100, 0, {}), /^M0,0 L100,0$/)
  assert.match(edgePath(0, 0, 100, 200, {}), /^M0,0 C/)
  assert.match(edgePath(0, 100, 50, 0, { hub: true }), /^M0,100 C/)
})

test('straightMid', () => {
  assert.deepEqual(straightMid({ x: 0, y: 0 }, { x: 10, y: 10 }), { x: 5, y: 5 })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL
- [ ] **Step 3: 最小实现**（`lib/geometry.js`）

```js
// 连线/补间数学：浏览器画布与 Node 单测共用同一实现
export function lerp(a, b, t) { return a + (b - a) * t }

export function straightMid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }

export function cubicMid(p0, p1, p2, p3, t) {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

export function edgePath(x1, y1, x2, y2, { hub = false, down = false } = {}) {
  if (Math.abs(y2 - y1) < 30 && !hub && !down) return 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2
  const dx = Math.max(40, Math.abs(x2 - x1) / 2)
  const c1x = hub ? x1 : x1 + dx
  const c2x = hub ? x2 : x2 - dx
  return 'M' + x1 + ',' + y1 + ' C' + c1x + ',' + y1 + ' ' + c2x + ',' + y2 + ' ' + x2 + ',' + y2
}
```

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: 提交**

```bash
git add presets/software-company/packages/company-r2/lib/geometry.js presets/software-company/packages/company-r2/tests/geometry.test.js
git commit -m "feat(canvas): 连线/贝塞尔中点/线性插值共用数学模块"
```

## Task 7: package.json 加测试脚本

**Files:**
- Modify: `presets/software-company/packages/company-r2/package.json`

- [ ] **Step 1: 编辑**

在 `"main": "./host.js",` 之前插入 `"scripts": { "test": "node --test tests/*.test.js" },`

- [ ] **Step 2: 运行全部单测**

Run: `cd presets/software-company/packages/company-r2 && npm test --silent 2>&1 | tail -4`
Expected: 全部 PASS（6 个测试文件）

- [ ] **Step 3: 提交**

```bash
git add presets/software-company/packages/company-r2/package.json
git commit -m "chore: 添加 node --test 单测脚本"
```

## Task 8: host.js —— roles 单一来源 + reasoning 分档（五刀④）

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js`
- Modify: `presets/software-company/roles/ROLES.md`

- [ ] **Step 1: 读现状**

Run: `grep -n "const ROLES\|^    }" presets/software-company/packages/company-r2/host.js | head -6`
记录内联 `const ROLES = {...}` 的起止行（L1–L2，约第 8–28 行）。

- [ ] **Step 2: 顶部加 import（文件第 1 行 `export default {` 之前）**

```js
import { FLOW_TEMPLATES, STAGES_LEGACY, validateFlow, readyNodes, adjustFlow } from './lib/flow.js'
import { createEventsFile, appendEvent, readSince } from './lib/events.js'
import { buildContract, validateContract, signContract, renderContractMarkdown, assertionBadges } from './lib/contract.js'
import { attributeUsage, aggregateByDepartment } from './lib/usage.js'
import { DEPT_ID_RE, validateHire, renderDeptPresetYml, mergeRole, undoRole } from './lib/hire.js'
```

- [ ] **Step 3: 替换内联 ROLES 为「文件优先 + 兜底」**

删除 L1–L2 整块内联 ROLES，替换为：

```js
    // 角色库单一来源：preset 根 roles/roles.json（reasoning 已按五刀④分档）
    const ROLES_FILE = new URL('../../roles/roles.json', import.meta.url).pathname
    const ROLES_FALLBACK = {
      'coordinator': { id: 'coordinator', title: 'Coordinator 项目总控', model: 'deepseek-v4-pro', reasoning: 'max' },
      'generator': { id: 'generator', title: '主程序员 Generator', model: 'deepseek-v4-pro', reasoning: 'high' },
    }
    let ROLES = ROLES_FALLBACK
    async function loadRoles() {
      try {
        const text = await readTextAt(ROLES_FILE)
        if (text !== undefined) {
          const data = JSON.parse(text)
          if (Array.isArray(data.roles)) ROLES = Object.fromEntries(data.roles.map((r) => [r.id, r]))
        }
      } catch (e) { /* 保留兜底 */ }
    }
    await loadRoles()
```

- [ ] **Step 4: 确认 readTextAt 在作用域内**

Run: `grep -n "async function readTextAt\|function readTextAt" presets/software-company/packages/company-r2/host.js`
Expected: 命中（若未命中，把上面 `readTextAt` 换成 host.js 既有文件读取 helper 名）

- [ ] **Step 5: ROLES.md 对齐档位**

`presets/software-company/roles/ROLES.md` 中四个 flash 角色的 `| high |` 依次改为：explorer → `| medium |`、qa-runner → `| medium |`、mechanical-worker → `| low |`、recorder → `| low |`；表头说明第 3 行「其余全部为 high」改为「其余 high；explorer/qa-runner=medium、mechanical-worker/recorder=low（五刀④）」。

- [ ] **Step 6: 同步 + 冒烟**

```bash
rsync -a presets/software-company/ ~/.dsh/.agent-presets/software-company/   # 需授权
node -e "import('/Users/xiaowanzi/.dsh/.agent-presets/software-company/roles/roles.json',{assert:{type:'json'}}).then(m=>console.log(m.default.roles.length))"
```
Expected: `14`

- [ ] **Step 7: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js presets/software-company/roles/ROLES.md
git commit -m "feat(engine): roles 单一来源 roles.json + 五刀④ reasoning 分档"
```

## Task 9: host.js —— 事件流接线 + `/company-api/events` 路由

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js`

- [ ] **Step 1: 定位 transition**

Run: `grep -n "async function transition" presets/software-company/packages/company-r2/host.js`
Expected: 命中一个行号（T 行）。读 T 行起 40 行，找到成功路径中 `saveState`（或等价保存调用）之后的点。

- [ ] **Step 2: 状态保存成功后追加事件**

在该点插入：

```js
    try {
      appendEvent(eventsFileFor(state), { type: 'status', taskId: state.taskId, from, to, reason })
    } catch (e) {}
```

并在 `async function taskDetail` 之前添加 helper（放 Web API 区上方）：

```js
    function eventsFileFor(state) {
      const base = state && state.projectDir ? state.projectDir : process.cwd()
      return createEventsFile(base + '/.company-harness/events')
    }
```

- [ ] **Step 3: 路由增加 events 分支**

在第 766 行 `/company-api/agents` 分支之后插入：

```js
            else if (p === '/company-api/events') out = await eventsSnapshot(q)
```

并在 handleAction 定义之前添加：

```js
    async function eventsSnapshot(q) {
      const file = createEventsFile(process.cwd() + '/.company-harness/events')
      const afterSeq = Number(q.get('seq') || 0)
      const events = readSince(file, afterSeq)
      return { events, nextSeq: events.length ? events[events.length - 1].seq : afterSeq }
    }
```

- [ ] **Step 4: 仓库内冒烟**

Run:
```bash
cd presets/software-company/packages/company-r2 && node -e "import('./lib/events.js').then(async m=>{const f=m.createEventsFile('/tmp/ev-smoke');m.appendEvent(f,{type:'smoke'});console.log(m.readSince(f,0).length)})"
```
Expected: `1`

- [ ] **Step 5: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js
git commit -m "feat(engine): 状态变化接入事件流 + /company-api/events 增量路由"
```

## Task 10: host.js —— DAG 流程写入/查询/调整（V6 兼容回退）

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js`

- [ ] **Step 1: company_start 状态字面量加 flow**

定位 company_start（约 880–893 行）中 `approvals: [], history: [], rolesLaunched: [], ownershipConflicts: [],` 一行，在其前插入：

```js
        flow: {
          template: type,
          nodes: (FLOW_TEMPLATES[type] || FLOW_TEMPLATES.small).nodes,
          adjustments: [],
          done: {},
        },
```

- [ ] **Step 2: 路由增加 flow 分支**

`/company-api/events` 分支后插入：

```js
            else if (p === '/company-api/flow') out = await flowSnapshot(q)
```

并添加：

```js
    async function flowSnapshot(q) {
      const state = await loadTask(q.get('taskId'))
      if (!state) return { error: '任务不存在' }
      if (!state.flow) return { legacy: true, stages: STAGES_LEGACY, current: state.status }
      const done = state.flow.done || {}
      return {
        legacy: false, nodes: state.flow.nodes, adjustments: state.flow.adjustments,
        done, ready: readyNodes(state.flow, new Set(Object.keys(done))),
        current: state.status,
      }
    }
```

- [ ] **Step 3: handleAction 支持 q 参数**

把 `async function handleAction(taskId, action)`（约 798 行）改为 `async function handleAction(taskId, action, q)`；路由调用（约 767 行）改为 `out = await handleAction(q.get('taskId'), q.get('action'), q)`。

- [ ] **Step 4: adjustFlow 分支**

在 handleAction 的 `if (action === 'resume')` 块之前插入：

```js
      if (action === 'adjustFlow') {
        if (!state.flow) return { ok: false, error: '旧任务无 DAG 流程' }
        const op = JSON.parse((q && q.get('op')) || 'null')
        try {
          const { flow } = adjustFlow(state.flow, op)
          state.flow = flow
          await saveState(state)
          appendEvent(eventsFileFor(state), { type: 'flow.adjusted', taskId: state.taskId, op })
          return { ok: true, nodes: state.flow.nodes }
        } catch (e) { return { ok: false, error: String(e.message || e) } }
      }
```

- [ ] **Step 5: 注册 company_adjust_flow 工具**

在工具注册区（`tool('company_pause'…` 或任一既有工具条目之后，照抄 `tool(name, description, properties, required, fn)` 形态）追加：

```js
    tool('company_adjust_flow', '调整当前任务的 DAG 流程模板（insert 插环节 / addParallel 加并行分支 / skip 跳环节），调整写进 RUN_STATE.flow.adjustments 并留痕。op 示例：{"op":"insert","after":"build","node":{"id":"lint","dept":"qa-runner","title":"Lint 门禁"}}', {
      taskId: S('任务编号'),
      op: { type: 'object', additionalProperties: true, description: '调整操作' },
    }, ['taskId', 'op'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在' }
      if (!state.flow) return { ok: false, error: '旧任务无 DAG 流程' }
      try {
        const { flow } = adjustFlow(state.flow, args.op)
        state.flow = flow
        await saveState(state)
        appendEvent(eventsFileFor(state), { type: 'flow.adjusted', taskId: state.taskId, op: args.op, by: 'agent' })
        return { ok: true, nodes: state.flow.nodes }
      } catch (e) { return { ok: false, error: String(e.message || e) } }
    })
```

- [ ] **Step 6: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js
git commit -m "feat(engine): DAG 流程写入/查询/调整 + 旧任务线性回退"
```

## Task 11: host.js —— 交接契约生成与签收

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js`

- [ ] **Step 1: helper（放 eventsFileFor 之后）**

```js
    function contractsDirOf(state) { return taskDirOf(state) + '/contracts' }

    async function ensureDir(dir) {
      const mk = (typeof ctx.fs !== 'undefined' && typeof ctx.fs.mkdir === 'function')
        ? ctx.fs.mkdir.bind(ctx.fs) : null
      if (mk) { try { await mk(dir, { recursive: true }) } catch (e) {} }
    }

    async function issueContract(state, from, to, detail) {
      const c = buildContract({ from, to, ...detail })
      const errs = validateContract(c)
      if (errs.length) throw new Error('契约非法: ' + errs.join('; '))
      const dir = contractsDirOf(state)
      await ensureDir(dir)
      const file = dir + '/' + from + '__' + to + '.md'
      await writeTextAt(file, renderContractMarkdown(c))
      appendEvent(eventsFileFor(state), { type: 'handoff.issued', taskId: state.taskId, from, to, file })
      return { file, contract: c }
    }

    async function signContractFor(state, from, to, by) {
      const file = contractsDirOf(state) + '/' + from + '__' + to + '.md'
      const text = await readTextAt(file)
      if (text === undefined) return { ok: false, error: '契约不存在: ' + file }
      const signed = signContract({ from, to }, by, now())
      await writeTextAt(file, renderContractMarkdown(signed))
      appendEvent(eventsFileFor(state), { type: 'handoff.signed', taskId: state.taskId, from, to, by })
      return { ok: true }
    }
```

- [ ] **Step 2: 环节完成发出契约**

在 transition 的 status 事件之后追加：

```js
    if (from && to && state.flow) {
      const fromNode = (state.flow.nodes || []).find((n) => n.id === from)
      const toNode = (state.flow.nodes || []).find((n) => n.id === to)
      if (fromNode && toNode) {
        try {
          await issueContract(state, from, to, {
            modules: (state.flow.modules || []),
            apiSignatures: (state.flow.apiSignatures || []),
            nonGoals: (state.flow.nonGoals || []),
            assertions: {},
          })
        } catch (e) {
          appendEvent(eventsFileFor(state), { type: 'handoff.error', taskId: state.taskId, error: String(e.message || e) })
        }
      }
    }
```

（注：旧状态机 transition 的 from/to 是 17 步 stage 名，不会命中 DAG 节点 id → 旧任务不产生契约文件，符合 V6。DAG 环节完成由 §2.3 的 stage.done 事件驱动：在 P1 验收前，把本块逻辑同时挂到「DAG stage 完成」的落点——见 Task 14 Step 1 的说明。）

- [ ] **Step 3: handleAction 增加 signContract（adjustFlow 分支后）**

```js
      if (action === 'signContract') {
        const from = q.get('from'), to = q.get('to'), by = q.get('by') || 'user'
        if (!from || !to) return { ok: false, error: 'from/to 必填' }
        return await signContractFor(state, from, to, by)
      }
```

- [ ] **Step 4: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js
git commit -m "feat(engine): 交接契约生成/签收与事件"
```

## Task 12: host.js —— 五刀③确定性徽章 + Explorer 缓存 + 并发核算

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js`

- [ ] **Step 1: 确定性徽章 helper**

```js
    async function deterministicBadgesFrom(state) {
      const out = {}
      try {
        const sid = state.currentSprint || (state.sprints && state.sprints.length ? state.sprints[state.sprints.length - 1].id : 'S01')
        const evidence = await readTextAt(sprintDirOf(state, sid) + '/QA_EVIDENCE.md')
        if (evidence) {
          out.tests = /测试[:：]\s*([0-9]+\/[0-9]+)/.exec(evidence)?.[1] || undefined
          out.lint = /lint/i.test(evidence)
          out.coverage = /覆盖率[:：]\s*([0-9.]+%?)/.exec(evidence)?.[1] || undefined
          out.build = /构建/.test(evidence)
        }
      } catch (e) {}
      return out
    }
```

- [ ] **Step 2: review.pass 带徽章**

在 transition 的 status 事件之后追加：

```js
    if (to === 'SPRINT_PASSED') {
      appendEvent(eventsFileFor(state), { type: 'review.pass', taskId: state.taskId, badges: assertionBadges(await deterministicBadgesFrom(state)) })
    }
```

- [ ] **Step 3: Explorer 调查缓存 helper**

```js
    function explorationFileFor(hash) {
      const dir = process.cwd() + '/.company-harness/explorations'
      try { require('node:fs').mkdirSync(dir, { recursive: true }) } catch (e) {}
      return dir + '/' + hash + '.json'
    }
```

在既有 explorer 派工指引（grep `explorer` 找 nextSteps/提示生成处）中追加一行提示：`调查结果按仓库哈希缓存到 .company-harness/explorations/<hash>.json，命中则直接复用（五刀⑤）。`

- [ ] **Step 4: 并发核算（基于 subagent/start|end 事件，非硬拦截）**

在 `agentLog` 定义附近追加：

```js
    const CONCURRENCY = { limit: 3 }
    function setConcurrencyLimit(n) {
      CONCURRENCY.limit = n
      appendEvent(createEventsFile(process.cwd() + '/.company-harness/events'), { type: 'concurrency.changed', limit: n })
      return n
    }
    function activeAgents() { return agentLog.filter((e) => e.kind === 'start').length - agentLog.filter((e) => e.kind === 'end').length }
```

（并发上限的强制生效靠 §2.1 的总监协议提示 + nextSteps 提示「当前活跃 X/上限 Y，请勿再派工」；硬拦截需 host 直派，不在 v1。）

- [ ] **Step 5: handleAction 顶部（loadTask 之前）加 concurrency 分支**

在 `async function handleAction(taskId, action, q) {` 行之后、`const state = await loadTask(taskId)` 之前插入：

```js
      if (action === 'concurrency') {
        const n = Number((q && q.get('n')) || 0)
        if (![2, 3, 4].includes(n)) return { ok: false, error: 'n 必须 2/3/4' }
        return { ok: true, limit: setConcurrencyLimit(n) }
      }
```

- [ ] **Step 6: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js
git commit -m "feat(engine): 确定性徽章 + Explorer 缓存 + 并发核算（五刀③⑤）"
```

## Task 13: host.js —— 裁决（瞬时 max 子代理）+ company_run_sprint

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js`

- [ ] **Step 1: 查询 subagents 服务契约（Inspect 工具，只读）**

Run: `cordis_inspect_list`（找到 subagents 相关 provider）→ `cordis_inspect_query`（查 `subagents` 服务的 spawn/launch 方法与参数，含 model/reasoning 覆盖字段名）。
Expected: 得到 spawn 调用的准确签名（记下来，后面两处都要用）。

- [ ] **Step 2: 裁决 helper（用 Step 1 的真实签名替换 `SPAWN(...)` 占位）**

```js
    async function adjudicate(question, options, state) {
      appendEvent(eventsFileFor(state), { type: 'adjudication.started', taskId: state.taskId, question })
      try {
        const result = await SPAWN({ /* Step 1 查到的调用形态 */ role: 'coordinator', model: 'deepseek-v4-pro', modelReasoningEffort: 'max', prompt: '你是总监裁决席。问题：' + question + '\n候选方案：' + JSON.stringify(options) + '\n只输出一个方案 id 与一句话依据。' })
        appendEvent(eventsFileFor(state), { type: 'adjudication.decided', taskId: state.taskId, decision: result })
        return result
      } catch (e) {
        appendEvent(eventsFileFor(state), { type: 'adjudication.failed', taskId: state.taskId, error: String(e.message || e) })
        throw e
      }
    }
```

（若 Step 1 显示 host 无直接 spawn 服务：改用「发事件 + nextSteps 提示 Coordinator 在下一个回合用 subagent 工具以 max 档裁决」的降级路径，并在注释里写明。）

- [ ] **Step 3: handleAction 加 decide（signContract 分支后）**

```js
      if (action === 'decide') {
        const opt = q.get('opt')
        appendEvent(eventsFileFor(state), { type: 'adjudication.decided', taskId: state.taskId, decision: opt, by: 'director-ui' })
        return { ok: true, decision: opt }
      }
```

- [ ] **Step 4: company_run_sprint 复合驱动工具（同样替换 SPAWN 占位）**

```js
    tool('company_run_sprint', '复合驱动：一个回合内按 DAG 就绪关系推进本 Sprint 全部环节（派工→等待→回报→下一环节）。裁决点除外。用于省主会话 token（五刀①进阶项）。', {
      taskId: S('任务编号'),
    }, ['taskId'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在' }
      if (!state.flow) return { ok: false, error: '旧任务无 DAG 流程' }
      const done = new Set(Object.keys(state.flow.done || {}))
      const log = []
      for (let guard = 0; guard < state.flow.nodes.length + 2; guard += 1) {
        const ready = readyNodes(state.flow, done)
        if (ready.length === 0) break
        const nodeId = ready[0]
        const node = state.flow.nodes.find((n) => n.id === nodeId)
        appendEvent(eventsFileFor(state), { type: 'stage.started', taskId: state.taskId, stage: nodeId, dept: node.dept })
        try {
          const result = await SPAWN({ /* Step 1 查到的调用形态 */ role: node.dept, prompt: '执行环节「' + (node.title || node.id) + '」，完成后用 company_record_evidence 回报。' })
          done.add(nodeId)
          state.flow.done[nodeId] = { at: now() }
          await saveState(state)
          appendEvent(eventsFileFor(state), { type: 'stage.done', taskId: state.taskId, stage: nodeId })
          log.push({ stage: nodeId, ok: true })
        } catch (e) {
          appendEvent(eventsFileFor(state), { type: 'stage.failed', taskId: state.taskId, stage: nodeId, error: String(e.message || e) })
          log.push({ stage: nodeId, ok: false, error: String(e.message || e) })
          return { ok: false, log }
        }
      }
      return { ok: true, log, done: [...done] }
    })
```

- [ ] **Step 5: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js
git commit -m "feat(engine): 裁决子代理（瞬时 max）+ company_run_sprint 复合驱动"
```

## Task 14: P0 端到端冒烟

**Files:** 无（验证任务）

- [ ] **Step 1: 同步 + 新会话**

```bash
rsync -a presets/software-company/ ~/.dsh/.agent-presets/software-company/   # 需授权
```
在 DSH 开新会话，发：`公司模式：帮我做一个带数据看板的待办应用（前端页面 + 后端 API + 数据层三模块）`
Expected: 分类 complex；`RUN_STATE.json` 出现 `flow.nodes` 含 fe/be/data；事件流文件出现 `task.created/status/…`

- [ ] **Step 2: 确认事件流**

Run: `tail -5 .company-harness/events/events.jsonl`
Expected: 有 `status` 事件且 seq 递增

- [ ] **Step 3: 确认 flow 查询**

Run: `curl -s "http://127.0.0.1:3080/company-api/flow?taskId=TASK-XXXXXX" | head -c 300`（替换真实 taskId）
Expected: JSON 含 `nodes/ready`

- [ ] **Step 4: 提交冒烟数据**

```bash
git add -A .company-harness && git commit -m "test(engine): P0 复杂任务 DAG 冒烟数据"
```

---

# Part P1 · 总监大画布

## Task 15: host.js —— `/company` 页面与静态资源路由

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js`
- Create: `presets/software-company/packages/company-r2/web/canvas.html`（先占位，Task 16 换真页）

- [ ] **Step 1: 注册路由**

在 `/company-api` 路由注册块（`}))` 及 catch 之后，Web API 区末尾）追加：

```js
    const webDir = new URL('./web/', import.meta.url).pathname
    try {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/company',
        handler: async function (req, res) {
          const html = await readTextAt(webDir + 'canvas.html')
          if (html === undefined) { res.writeHead(404); res.end('canvas.html missing'); return }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(html)
        },
      }))
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/company/static',
        handler: async function (req, res) {
          const p = new URL(req.url || '/', 'http://x').pathname.replace('/company/static/', '')
          if (!/^[a-zA-Z0-9_.-]+$/.test(p)) { res.writeHead(400); res.end('bad path'); return }
          const text = await readTextAt(webDir + p)
          if (text === undefined) { res.writeHead(404); res.end('not found'); return }
          const type = p.endsWith('.js') ? 'text/javascript; charset=utf-8' : (p.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/plain; charset=utf-8')
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
          res.end(text)
        },
      }))
    } catch (e) { /* 多实例复用首实例路由 */ }
```

- [ ] **Step 2: 占位页**（`web/canvas.html`）

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Company Canvas</title></head>
<body><h2>总监大画布（Task 16 接入真页）</h2></body></html>
```

- [ ] **Step 3: 同步 + 冒烟**

```bash
rsync -a presets/software-company/ ~/.dsh/.agent-presets/software-company/   # 需授权
```
DSH **新开会话**后：
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/company`
Expected: `200`

- [ ] **Step 4: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js presets/software-company/packages/company-r2/web/
git commit -m "feat(canvas): /company 页面与静态资源路由"
```

## Task 16: web/canvas.html —— 由定稿演示改造真页

**Files:**
- Modify: `presets/software-company/packages/company-r2/web/canvas.html`

- [ ] **Step 1: 复制定稿演示**

Run: `cp .superpowers/brainstorm-stable/content/s03-final-layout-v2.html presets/software-company/packages/company-r2/web/canvas.html`

- [ ] **Step 2: 编辑头部与移除确认区**

删除 `<h2>§3 最终布局 v2：总监大画布（交互演示）</h2>` 与其 subtitle 段，替换为 `<h2>总监大画布</h2><p class="subtitle">真实数据 2s 增量拉取 · 节点可拖动连线跟随 · 悬停看信息卡 · 画布上直接审批/决策</p>`；删除文件底部整个 `.section`（「§3 最终布局确认（v2）」的 options 块）。

- [ ] **Step 3: chips 接线（去掉 toggleSelect，接真实任务）**

把三个 chip 的 `onclick="toggleSelect(this)"` 依次替换为：
- TASK-001 → `onclick="window.__selectTask('TASK-20260815-001')"`
- TASK-002 → `onclick="window.__selectTask('TASK-20260815-002')"`
- TASK-003 → `onclick="window.__selectTask('TASK-20260815-003')"`

- [ ] **Step 4: 替换内联脚本为外部脚本**

删除末尾整个 `<script>…</script>`（演示模拟代码全部删），在 modal 之后插入：

```html
<script src="/company/static/geometry.js"></script>
<script src="/company/static/canvas.js"></script>
```

- [ ] **Step 5: 复制 geometry 静态副本**

Run: `cp presets/software-company/packages/company-r2/lib/geometry.js presets/software-company/packages/company-r2/web/geometry.js`
并在其末尾追加：

```js
if (typeof window !== 'undefined') window.Geometry = { lerp: lerp, straightMid: straightMid, cubicMid: cubicMid, edgePath: edgePath }
```

- [ ] **Step 6: 提交**

```bash
git add presets/software-company/packages/company-r2/web/
git commit -m "feat(canvas): 定稿演示改造为 /company 真页骨架"
```

## Task 17: web/canvas.js —— 数据层 + 动态渲染 + 交互

**Files:**
- Create: `presets/software-company/packages/company-r2/web/canvas.js`

- [ ] **Step 1: 写完整文件**

```js
/* 总监大画布数据层：2s 增量拉取事件流 + 快照，前端线性补间渲染。零依赖。 */
(function () {
  'use strict'
  var $ = function (id) { return document.getElementById(id) }
  var cv = $('cv')
  var STATE = { tasks: [], events: [], seq: 0, depts: {}, done: {}, flow: null, focusTask: null, workingStage: null, concurrency: 3 }
  var DRAG = null

  var STATUS_STYLE = {
    working: { border: '#a78bfa', bg: '#150b2e', color: '#c4b5fd' },
    queued: { border: '#3b82f6', bg: '#0a1626', color: '#93c5fd' },
    idle: { border: '#4b5563', bg: '#111827', color: '#9ca3af' },
    done: { border: '#22c55e', bg: '#0a1f12', color: '#86efac' },
    blocked: { border: '#7f1d1d', bg: '#180909', color: '#fca5a5' },
  }

  function api(path) {
    return fetch(path, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json() })
  }
  function fmt(n) { return n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : (n / 1000).toFixed(1) + 'k' }

  function layout(nodes) {
    var pos = {}, placed = new Set(), rows = []
    while (placed.size < nodes.length) {
      var ready = nodes.filter(function (n) { return !placed.has(n.id) && (n.needs || []).every(function (x) { return placed.has(x) || !nodes.some(function (m) { return m.id === x }) }) })
      if (ready.length === 0) ready = nodes.filter(function (n) { return !placed.has(n.id) })
      rows.push(ready); ready.forEach(function (n) { placed.add(n.id) })
    }
    rows.forEach(function (row, i) {
      var x = 40 + i * 190
      var y0 = 150 - ((row.length - 1) * 100) / 2
      row.forEach(function (n, j) { pos[n.id] = { x: x, y: y0 + j * 100 } })
    })
    return pos
  }

  function renderNodes(flow) {
    if (!cv) return
    cv.querySelectorAll('.nd').forEach(function (el) { if (el.id !== 'nd-coord') el.remove() })
    if (!flow) return
    var nodes = flow.nodes.filter(function (n) { return !n.skipped })
    var pos = layout(nodes)
    nodes.forEach(function (n) {
      var st = STATE.done[n.id] ? 'done' : (STATE.workingStage === n.id ? 'working' : 'queued')
      var s = STATUS_STYLE[st]
      var el = document.createElement('div')
      el.className = 'nd' + (st === 'working' ? ' work' : '')
      el.id = 'nd-' + n.id
      el.style.cssText = 'left:' + pos[n.id].x + 'px;top:' + pos[n.id].y + 'px;width:130px;border-color:' + s.border + ';background:' + s.bg + ';color:' + s.color
      var toks = STATE.depts[n.dept] ? ' · ⚡ ' + fmt(STATE.depts[n.dept].totalTokens) : ''
      el.innerHTML = (st === 'done' ? '✅ ' : (st === 'working' ? '⚙ ' : '⏳ ')) + (n.title || n.id) + '<small>' + n.dept + toks + '</small>'
      el.addEventListener('click', function () { openDept(n) })
      el.addEventListener('mousedown', startDrag)
      el.addEventListener('mouseenter', function (ev) {
        var r = cv.getBoundingClientRect()
        showTip(ev, tipHtml(n), el.offsetLeft + el.offsetWidth + 14, el.offsetTop)
      })
      el.addEventListener('mouseleave', window.hideTip)
      cv.appendChild(el)
    })
    renderEdges(flow)
  }

  function tipHtml(n) {
    var d = STATE.depts[n.dept] || {}
    return '<h4>' + (n.title || n.id) + '</h4><div>' + (STATE.done[n.id] ? '✅ 已完成' : (STATE.workingStage === n.id ? '⚙ 工作中' : '⏳ 排队/等待')) + '</div>' +
      '<div style="color:#9ca3af;margin-top:3px;">部门：' + n.dept + ' · 模型：' + (d.model || '?') + ' · ' + (d.reasoning || '?') + '<br/>token 本轮 ' + fmt(d.totalTokens || 0) + ' · 排名 ' + (d.rank || '-') + '</div>'
  }

  function showTip(ev, html, x, y) {
    var t = $('tip')
    if (!t) return
    t.innerHTML = html
    t.style.display = 'block'
    t.style.left = x + 'px'
    t.style.top = y + 'px'
    if (x + 262 > 1376) t.style.left = (x - 260) + 'px'
    if (y + 190 > 560) t.style.top = (y - 190) + 'px'
  }
  window.hideTip = function () { var t = $('tip'); if (t) t.style.display = 'none' }

  function openDept(node) {
    var d = STATE.depts[node.dept] || {}
    fillPanel('<div style="font-weight:700;color:#7dd3fc;padding:6px 10px;">部门抽屉：' + (node.title || node.id) + '</div>' +
      '<div class="drawer"><div class="k">模型</div>' + (d.model || '?') + ' · ' + (d.reasoning || '?') +
      '<div class="k" style="margin-top:6px;">token</div>本轮 ' + fmt(d.totalTokens || 0) + ' · 排名 ' + (d.rank || '-') +
      '<div class="k" style="margin-top:6px;">参与任务</div>' + (d.tasks || []).join(' · ') +
      '</div><div class="btn" style="margin:8px 10px;" onclick="window.__closePanel()">✕ 关闭</div>')
  }
  function fillPanel(html) {
    $('rail-drawer').innerHTML = html
    $('rail-drawer').style.display = 'block'
    $('rail-default').style.display = 'none'
  }
  window.__closePanel = function () {
    $('rail-drawer').style.display = 'none'
    $('rail-default').style.display = 'block'
  }

  window.openApprove = function () {
    fillPanel('<div style="font-weight:700;color:#fbbf24;padding:6px 10px;">🔔 待你审批</div><div class="drawer" id="approveList">加载中…</div>' +
      '<div class="btn" style="margin:8px 10px;" onclick="window.__closePanel()">✕ 关闭</div>')
    api('/company-api/dashboard').then(function (d) {
      var waits = (d.tasks || []).filter(function (t) { return t.status === 'WAITING_INITIAL_APPROVAL' })
      if (!waits.length) { $('approveList').textContent = '当前没有待审批任务。'; return }
      $('approveList').innerHTML = waits.map(function (t) {
        return '<div style="background:#1a1408;border:1px solid #f59e0b;border-radius:10px;padding:10px;margin-bottom:8px;"><b>' + t.taskId + '</b><div class="k">需求</div>' +
          (t.requirement || '').slice(0, 80) + '<div style="margin-top:8px;display:flex;gap:6px;">' +
          '<button class="btn" style="border-color:#22c55e;color:#86efac;" onclick="window.__act(\'' + t.taskId + '\',\'approve\')">✅ 批准并派工</button>' +
          '<button class="btn" style="border-color:#ef4444;color:#fca5a5;" onclick="window.__act(\'' + t.taskId + '\',\'terminate\')">❌ 拒绝终止</button></div></div>'
      }).join('')
    }).catch(function () { $('approveList').textContent = '加载失败。' })
  }
  window.openDecision = function () {
    fillPanel('<div style="font-weight:700;color:#fbbf24;padding:6px 10px;">⚖ 待你决策：并发名额</div><div class="drawer">当前并发上限 ' +
      (STATE.concurrency || 3) + '。<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">' +
      '<button class="btn" style="border-color:#22c55e;color:#86efac;text-align:left;" onclick="window.__act2(3)">A. 保持上限（排队等待）</button>' +
      '<button class="btn" style="border-color:#3b82f6;color:#93c5fd;text-align:left;" onclick="window.__act2(4)">B. 临时提升并发上限至 4</button>' +
      '<button class="btn" style="border-color:#ef4444;color:#fca5a5;text-align:left;" onclick="window.__act2(2)">C. 收紧到 2（省 token）</button>' +
      '</div></div><div class="btn" style="margin:8px 10px;" onclick="window.__closePanel()">✕ 关闭</div>')
  }
  window.setConcurrency = function (n) { window.__act2(n) }
  window.__act = function (taskId, action) {
    api('/company-api/action?taskId=' + encodeURIComponent(taskId) + '&action=' + encodeURIComponent(action)).then(function () { poll() })
  }
  window.__act2 = function (n) {
    api('/company-api/action?action=concurrency&n=' + n).then(function () { poll() })
  }

  function renderEdges() { /* 桩：Task 18 替换为完整实现 */ }

  function startDrag(e) {
    e.preventDefault()
    DRAG = { el: e.currentTarget, dx: e.clientX - e.currentTarget.offsetLeft, dy: e.clientY - e.currentTarget.offsetTop, moved: false }
    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', endDrag)
  }
  function onDrag(e) {
    if (!DRAG) return
    DRAG.moved = true
    var r = cv.getBoundingClientRect()
    DRAG.el.style.left = Math.max(0, Math.min(1300, e.clientX - r.left - DRAG.dx)) + 'px'
    DRAG.el.style.top = Math.max(0, Math.min(500, e.clientY - r.top - DRAG.dy)) + 'px'
    renderEdges(STATE.flow)
  }
  function endDrag() { DRAG = null; document.removeEventListener('mousemove', onDrag); document.removeEventListener('mouseup', endDrag) }

  var tok = { cur: 0, target: 0, anim: false }
  function tickTokens() {
    if (tok.anim) return
    var from = tok.cur, to = tok.target, t0 = performance.now(), dur = 1900
    tok.anim = true
    function step(t) {
      var p = Math.min(1, (t - t0) / dur)
      var v = from + (to - from) * p
      var el = $('tokTotal'); if (el) el.textContent = fmt(v)
      var cap = $('capTok'); if (cap) cap.textContent = fmt(v)
      if (p < 1) requestAnimationFrame(step); else { tok.cur = to; tok.anim = false }
    }
    requestAnimationFrame(step)
  }

  function pushEvent(ev) {
    var row = document.createElement('div')
    row.className = 'ev'
    row.innerHTML = '<b>' + (ev.ts || '').slice(11, 19) + '</b> ' + ev.type + (ev.stage ? ' · ' + ev.stage : '') + (ev.badges ? ' · ' + ev.badges : '')
    $('evList').insertBefore(row, $('evList').firstChild)
  }

  function showAdjNode(ev) {
    var old = $('nd-adj')
    if (old) old.remove()
    var el = document.createElement('div')
    el.className = 'nd adj'
    el.id = 'nd-adj'
    el.style.cssText = 'left:720px;top:250px;width:88px;height:52px;line-height:1.5;'
    el.innerHTML = '⚖ 裁决<br/><b style="font-size:9px;">' + (ev.ts || '').slice(11, 16) + '</b>'
    el.addEventListener('click', window.openDecision)
    cv.appendChild(el)
  }

  function poll() {
    api('/company-api/events?seq=' + STATE.seq).then(function (d) {
      (d.events || []).forEach(function (ev) {
        STATE.seq = ev.seq
        pushEvent(ev)
        if (ev.type === 'stage.started') STATE.workingStage = ev.stage
        if (ev.type === 'stage.done') { STATE.done[ev.stage] = { at: ev.ts }; STATE.workingStage = null; if (STATE.flow) renderNodes(STATE.flow) }
        if (ev.type === 'adjudication.started') showAdjNode(ev)
        if (ev.type === 'adjudication.decided') { var a = $('nd-adj'); if (a) a.remove() }
      })
    }).catch(function () {})
    api('/company-api/canvas').then(function (d) {
      STATE.tasks = d.tasks || []
      STATE.depts = d.depts || {}
      STATE.concurrency = d.concurrency || 3
      tok.target = d.totalTokens || 0
      tickTokens()
      var fid = STATE.focusTask || (STATE.tasks[0] && STATE.tasks[0].taskId)
      if (fid) {
        api('/company-api/flow?taskId=' + encodeURIComponent(fid)).then(function (f) {
          if (f.legacy) { STATE.flow = null; renderNodes(null); return }
          STATE.flow = f
          STATE.done = f.done || {}
          renderNodes(f)
        }).catch(function () {})
      }
    }).catch(function () {})
  }

  window.__selectTask = function (id) { STATE.focusTask = id; poll() }

  setInterval(poll, 2000)
  poll()
})()
```

- [ ] **Step 2: 冒烟**

Run: `node --check presets/software-company/packages/company-r2/web/canvas.js`
Expected: 无输出（语法通过）

- [ ] **Step 3: 提交**

```bash
git add presets/software-company/packages/company-r2/web/canvas.js
git commit -m "feat(canvas): 数据层轮询/节点渲染/抽屉/审批决策/token 补间"
```

## Task 18: web/canvas.js —— 连线渲染（renderEdges）

**Files:**
- Modify: `presets/software-company/packages/company-r2/web/canvas.js`

- [ ] **Step 1: 替换 Task 17 的 renderEdges 桩，插入完整实现（在 IIFE 内、`function renderEdges() { /* 桩 */ }` 处）**

```js
  function nodeBox(id) {
    var el = $('nd-' + id)
    if (!el) return null
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
  }
  function renderEdges(flow) {
    var svg = $('edges')
    if (!svg || !flow) return
    svg.querySelectorAll('.edge,.docicon').forEach(function (el) { el.remove() })
    var nodes = flow.nodes.filter(function (n) { return !n.skipped })
    var GEO = window.Geometry || {}
    var index = {}
    nodes.forEach(function (n) { index[n.id] = n })
    nodes.forEach(function (n) {
      ;(n.needs || []).forEach(function (need) {
        if (!index[need]) return
        var a = nodeBox(need), b = nodeBox(n.id)
        if (!a || !b) return
        var x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2
        var d = GEO.edgePath ? GEO.edgePath(x1, y1, x2, y2, {}) : ('M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2)
        var done = !!STATE.done[n.id]
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        p.setAttribute('class', 'edge')
        p.setAttribute('d', d)
        p.setAttribute('stroke', done ? '#22c55e' : '#64748b')
        p.setAttribute('stroke-width', '2')
        p.setAttribute('fill', 'none')
        p.setAttribute('marker-end', done ? 'url(#arwG)' : 'url(#arw)')
        svg.appendChild(p)
        var mid = GEO.straightMid ? GEO.straightMid({ x: x1, y: y1 }, { x: x2, y: y2 }) : { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }
        if (Math.abs(y2 - y1) >= 30 && GEO.cubicMid) {
          var dx = Math.max(40, Math.abs(x2 - x1) / 2)
          mid = GEO.cubicMid({ x: x1, y: y1 }, { x: x1 + dx, y: y1 }, { x: x2 - dx, y: y2 }, { x: x2, y: y2 }, 0.5)
        }
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        g.setAttribute('class', 'docicon')
        g.setAttribute('transform', 'translate(' + Math.round(mid.x) + ',' + Math.round(mid.y) + ')')
        g.style.cursor = 'pointer'
        g.addEventListener('click', function () { window.openDoc(STATE.focusTask, need, n.id) })
        g.addEventListener('mouseenter', function (ev) { showTip(ev, '<h4>📄 交接契约：' + need + ' → ' + n.id + '</h4><div style="color:#9ca3af;">点击查看全文（模块图/API 签名/非目标）</div>', mid.x + 16, mid.y - 12) })
        g.addEventListener('mouseleave', window.hideTip)
        var hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        hit.setAttribute('r', '16'); hit.setAttribute('fill', 'transparent')
        var c0 = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        c0.setAttribute('r', '11'); c0.setAttribute('fill', '#0b0f19'); c0.setAttribute('stroke', '#64748b'); c0.setAttribute('stroke-width', '1.5')
        var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        txt.setAttribute('x', '0'); txt.setAttribute('y', '3.5'); txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('font-size', '11')
        txt.textContent = '📄'
        g.appendChild(hit); g.appendChild(c0); g.appendChild(txt)
        svg.appendChild(g)
      })
    })
  }
```

- [ ] **Step 2: 契约全文弹窗（IIFE 内追加）**

```js
  window.openDoc = function (taskId, from, to) {
    api('/company-api/contract?taskId=' + encodeURIComponent(taskId || '') + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to))
      .then(function (d) {
        $('modal-card').innerHTML = '<pre style="white-space:pre-wrap;font-size:11px;">' + ((d.markdown || d.error || '暂无').replace(/</g, '&lt;')) + '</pre>' +
          '<div style="margin-top:10px;text-align:right;"><button class="btn" onclick="window.__closeDoc()">关闭</button></div>'
        $('modal').classList.add('on')
      }).catch(function () {})
  }
  window.__closeDoc = function () { $('modal').classList.remove('on') }
```

- [ ] **Step 3: host 增加 /company-api/contract 路由**

`/company-api/flow` 分支后插入 `else if (p === '/company-api/contract') out = await contractSnapshot(q)`，并添加：

```js
    async function contractSnapshot(q) {
      const state = await loadTask(q.get('taskId'))
      if (!state) return { error: '任务不存在' }
      const file = contractsDirOf(state) + '/' + q.get('from') + '__' + q.get('to') + '.md'
      const markdown = await readTextAt(file)
      return markdown === undefined ? { error: '契约不存在' } : { markdown }
    }
```

- [ ] **Step 4: 提交**

```bash
git add presets/software-company/packages/company-r2/web/canvas.js presets/software-company/packages/company-r2/host.js
git commit -m "feat(canvas): 连线实时计算跟随 + 契约图标悬停/全文弹窗"
```

## Task 19: host.js —— `/company-api/canvas` 聚合快照

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js`

- [ ] **Step 1: 路由分支**（`/company-api/contract` 后）

```js
            else if (p === '/company-api/canvas') out = await canvasSnapshot()
```

- [ ] **Step 2: 快照实现**

```js
    async function canvasSnapshot() {
      const tokens = await tokensSnapshot().catch(function () { return { rows: [] } })
      const dispatches = await listDispatchRecords()
      const attributed = attributeUsage(tokens.rows || [], dispatches)
      const depts = aggregateByDepartment(attributed)
      const tasks = await listAllTasks()
      return {
        tasks: tasks.map(function (t) { return { taskId: t.taskId, status: t.status, type: t.type, requirement: (t.requirement || '').slice(0, 120) } }),
        depts, totalTokens: (tokens.rows || []).reduce(function (s, r) { return s + (r.totalTokens || 0) }, 0),
        concurrency: CONCURRENCY.limit || 3,
        at: now(),
      }
    }
```

- [ ] **Step 3: 派工登记**

Run: `grep -n "rolesLaunched\|company_record_role" presets/software-company/packages/company-r2/host.js | head`
若存在 rolesLaunched 登记：实现 `listDispatchRecords` 读取全部任务的 `rolesLaunched`（含 role/sessionId/taskId/at 字段；无 sessionId 的行跳过归属，标注估算）。若字段不足，追加一个登记 helper：

```js
    const DISPATCH_FILE = process.cwd() + '/.company-harness/dispatches.jsonl'
    function recordDispatch(d) { appendEvent(DISPATCH_FILE, d) }
    async function listDispatchRecords() {
      const text = await readTextAt(DISPATCH_FILE)
      if (!text) return []
      return text.split('\n').filter(Boolean).map(function (l) { try { return JSON.parse(l) } catch (e) { return null } }).filter(Boolean)
    }
```

并在 `ctx.on('subagent/start', …)`（约 603 行）里追加 `recordDispatch({ sessionId: info.id, at: now() })`（taskId/department 由后续 `company_record_role` 补充时回填；归属缺失的行不计入部门聚合）。

- [ ] **Step 4: 同步 + 冒烟**

```bash
rsync -a presets/software-company/ ~/.dsh/.agent-presets/software-company/   # 需授权
```
DSH 新会话后：
Run: `curl -s "http://127.0.0.1:3080/company-api/canvas" | head -c 400`
Expected: JSON 含 `tasks/depts/totalTokens/concurrency`

- [ ] **Step 5: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js
git commit -m "feat(canvas): /company-api/canvas 聚合快照"
```

## Task 20: client.js —— 胶囊升级（注册块不动）

**Files:**
- Modify: `presets/software-company/packages/company-r2/client.js`

- [ ] **Step 1: 定位胶囊**

Run: `grep -n "const pill = el('button'" presets/software-company/packages/company-r2/client.js`
Expected: 约 54 行

- [ ] **Step 2: pill 点击监听之后插入画布链接**

```js
  const canvasLink = el('a', { pointerEvents: 'auto', cursor: 'pointer', background: '#f59e0b', color: '#0b0f19', border: '1px solid #f59e0b', borderRadius: '22px', padding: '10px 14px', fontSize: '13px', fontWeight: '700', textDecoration: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.35)' }, '\u{1F5FA} 总监大画布')
  canvasLink.setAttribute('href', '/company')
  canvasLink.setAttribute('target', '_blank')
```

- [ ] **Step 3: render() 未展开分支并排渲染**

把 `if (!open) { root.appendChild(pill); return }` 替换为：

```js
    if (!open) {
      const wrap = el('div', { display: 'flex', gap: '8px', alignItems: 'center' })
      wrap.appendChild(pill)
      wrap.appendChild(canvasLink)
      root.appendChild(wrap)
      return
    }
```

- [ ] **Step 4: 验证注册契约未动**

Run: `tail -8 presets/software-company/packages/company-r2/client.js`
Expected: `window.__ModuleLoader__.load({ id: '/Users/xiaowanzi/.dsh/.agent-presets/software-company/packages/company-r2', factory: … })` 一字未改

- [ ] **Step 5: 同步 + 验证**

```bash
rsync -a presets/software-company/ ~/.dsh/.agent-presets/software-company/   # 需授权
```
浏览器刷新 `http://127.0.0.1:3080`：无 "Failed to load plugins" 横幅；右上角出现「🏢 Company」+「🗺 总监大画布」。

- [ ] **Step 6: 提交**

```bash
git add presets/software-company/packages/company-r2/client.js
git commit -m "feat(canvas): 胶囊增加总监大画布入口（注册契约未动）"
```

## Task 21: P1 验收（V1–V4）

**Files:** 无（验证任务）

- [ ] **Step 1: V1 并行可见** —— 用 P0 复杂任务，浏览器开 `/company`：fe/be/data 三节点出现；working 节点紫光；queued 节点蓝色
- [ ] **Step 2: V2 交接可见** —— 点击任一 📄：弹窗显示契约 markdown；`handoff.signed` 事件出现
- [ ] **Step 3: V3 总监可干预** —— 🔔 审批 + ⚖ 决策面板切换并发上限：事件流出现 `adjudication.decided` / `concurrency.changed`
- [ ] **Step 4: V4 token 口径** —— 悬停部门节点：信息卡含本轮/累计 token 与排名；顶栏总量平滑滚动
- [ ] **Step 5: 提交验收记录**

```bash
git add -A .company-harness && git commit -m "test(canvas): P1 V1-V4 验收记录"
```

---

# Part P2 · 招聘/改造部门

## Task 22: 部门模板 preset

**Files:**
- Create: `presets/software-company/packages/company-r2/templates/dept/agent.cordis.yml`
- Create: `presets/software-company/packages/company-r2/templates/dept/preset.yml`

- [ ] **Step 1: 写模板**

`agent.cordis.yml`：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      你是公司的一个执行部门，只完成派给你的环节，不修改公司状态、合同与台账。
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536
```

`preset.yml`：

```yaml
name: company-dept
description: 招聘的软件公司执行部门
```

- [ ] **Step 2: 提交**

```bash
git add presets/software-company/packages/company-r2/templates/dept/
git commit -m "feat(hire): 部门 preset 复制基线模板"
```

## Task 23: host.js —— hire/upgrade/undo 动作与工具

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js`

- [ ] **Step 1: handleAction 顶部（loadTask 之前、concurrency 分支之后）加三个分支**

```js
      if (action === 'hire' || action === 'upgradeDept' || action === 'undoHire') {
        const deptRoot = new URL('../../../../.agent-presets/', import.meta.url).pathname
        if (action === 'hire') {
          const req = JSON.parse((q && q.get('req')) || 'null')
          if (!req) return { ok: false, error: 'req 必填' }
          const errs = validateHire(req)
          if (errs.length) return { ok: false, error: errs.join('; ') }
          const dir = deptRoot + 'company-dept-' + req.id
          await ensureDir(dir)
          await writeTextAt(dir + '/agent.cordis.yml', renderDeptPresetYml(req))
          await writeTextAt(dir + '/preset.yml', 'name: company-dept-' + req.id + '\n')
          const roles = JSON.parse(await readTextAt(ROLES_FILE))
          try {
            const merged = mergeRole(roles.roles, { id: req.id, title: req.title, model: req.model, reasoning: req.reasoning, source: 'hired' })
            await writeTextAt(ROLES_FILE, JSON.stringify({ specSection: roles.specSection, count: merged.length, note: roles.note, roles: merged }, null, 2))
          } catch (e) { return { ok: false, error: String(e.message || e) } }
          await loadRoles()
          appendEvent(createEventsFile(process.cwd() + '/.company-harness/events'), { type: 'dept.hired', dept: req.id, dir })
          return { ok: true, dir, role: req.id }
        }
        if (action === 'upgradeDept') {
          const req = JSON.parse((q && q.get('req')) || 'null')
          if (!req || !DEPT_ID_RE.test(req.id || '')) return { ok: false, error: 'req.id 非法' }
          const dir = deptRoot + 'company-dept-' + req.id
          await writeTextAt(dir + '/agent.cordis.yml', renderDeptPresetYml(req))
          const roles = JSON.parse(await readTextAt(ROLES_FILE))
          const merged = roles.roles.map(function (r) {
            if (r.id === req.id) return { ...r, title: req.title, model: req.model, reasoning: req.reasoning }
            return r
          })
          await writeTextAt(ROLES_FILE, JSON.stringify({ specSection: roles.specSection, count: merged.length, note: roles.note, roles: merged }, null, 2))
          await loadRoles()
          appendEvent(createEventsFile(process.cwd() + '/.company-harness/events'), { type: 'dept.upgraded', dept: req.id })
          return { ok: true }
        }
        const id = q.get('id')
        if (!DEPT_ID_RE.test(id || '')) return { ok: false, error: 'id 非法' }
        const roles = JSON.parse(await readTextAt(ROLES_FILE))
        try {
          const merged = undoRole(roles.roles, id)
          await writeTextAt(ROLES_FILE, JSON.stringify({ specSection: roles.specSection, count: merged.length, note: roles.note, roles: merged }, null, 2))
        } catch (e) { return { ok: false, error: String(e.message || e) } }
        try { await renameDir(deptRoot + 'company-dept-' + id, deptRoot + '.archived-company-dept-' + id) } catch (e) {}
        await loadRoles()
        appendEvent(createEventsFile(process.cwd() + '/.company-harness/events'), { type: 'dept.undone', dept: id })
        return { ok: true }
      }
```

（`renameDir` 用 host.js 既有的 rename helper（grep `rename`），或 `ctx.fs.rename` 的等价调用；没有就跳过归档、只移除注册并返回提示。）

- [ ] **Step 2: 注册两个工具**（照抄 tool() 形态）

```js
    tool('company_hire_department', '招聘新部门：创建 company-dept-<id> preset 并注册进角色库。id=[a-z0-9-]{2,32}；model=deepseek-v4-pro|deepseek-v4-flash；reasoning=low|medium|high；tools 可选 bash/fs/search/jobs/subagent/web/ask/todo。新部门无 company_* 引擎工具。', {
      id: S('部门 id'), title: S('部门名'), persona: S('职责人设'), model: SE('模型', ['deepseek-v4-pro', 'deepseek-v4-flash']), reasoning: SE('reasoning', ['low', 'medium', 'high']), tools: SA('工具集'),
    }, ['id', 'title', 'persona', 'model', 'reasoning'], async function (args) {
      const errs = validateHire(args)
      if (errs.length) return { ok: false, error: errs.join('; ') }
      return await handleAction('', 'hire', new URLSearchParams({ req: JSON.stringify(args) }))
    })

    tool('company_upgrade_department', '改造部门的人设/模型/reasoning/工具集（写回该部门 preset，只影响下次派工）。', {
      id: S('部门 id'), title: S('部门名'), persona: S('职责人设'), model: SE('模型', ['deepseek-v4-pro', 'deepseek-v4-flash']), reasoning: SE('reasoning', ['low', 'medium', 'high']), tools: SA('工具集'),
    }, ['id'], async function (args) {
      const errs = validateHire({ ...args, tools: args.tools || [] })
      if (errs.length) return { ok: false, error: errs.join('; ') }
      return await handleAction('', 'upgradeDept', new URLSearchParams({ req: JSON.stringify(args) }))
    })
```

- [ ] **Step 3: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js
git commit -m "feat(hire): 招聘/改造/撤销动作与工具（标准角色不可覆盖/撤销）"
```

## Task 24: canvas.js —— 招聘面板 UI

**Files:**
- Modify: `presets/software-company/packages/company-r2/web/canvas.js`
- Modify: `presets/software-company/packages/company-r2/web/canvas.html`

- [ ] **Step 1: canvas.js 追加**

```js
  window.openHire = function () {
    fillPanel('<div style="font-weight:700;color:#fbbf24;padding:6px 10px;">＋ 招聘部门（三步）</div><div class="drawer">' +
      '<div class="k">① 定义</div><input class="mock-input" id="hireId" placeholder="部门 id（小写字母数字-，如 qa-auto）" style="margin-bottom:6px;">' +
      '<input class="mock-input" id="hireTitle" placeholder="部门名（如 自动化测试部）" style="margin-bottom:6px;">' +
      '<input class="mock-input" id="hirePersona" placeholder="职责人设（一句话）">' +
      '<div class="k" style="margin-top:8px;">② 装备</div>' +
      '<select class="mock-input" id="hireModel" style="margin-bottom:6px;"><option value="deepseek-v4-flash">deepseek-v4-flash</option><option value="deepseek-v4-pro">deepseek-v4-pro</option></select>' +
      '<select class="mock-input" id="hireReasoning"><option value="medium">reasoning: medium</option><option value="low">reasoning: low</option><option value="high">reasoning: high</option></select>' +
      '<div class="k" style="margin-top:8px;">③ 挂流程</div>新部门进角色库后，用 company_adjust_flow 把它插进流程模板。' +
      '<div style="margin-top:10px;display:flex;gap:6px;">' +
      '<button class="btn" style="border-color:#22c55e;color:#86efac;" onclick="window.__hire()">✅ 招聘（写 ~/.dsh 前将请求授权）</button>' +
      '<button class="btn" style="border-color:#ef4444;color:#fca5a5;" onclick="window.__closePanel()">取消</button></div>' +
      '<div id="hireMsg" style="margin-top:8px;color:#9ca3af;"></div></div>')
  }
  window.__hire = function () {
    var req = {
      id: $('hireId').value.trim(), title: $('hireTitle').value.trim(), persona: $('hirePersona').value.trim(),
      model: $('hireModel').value, reasoning: $('hireReasoning').value, tools: ['bash', 'fs', 'ask', 'todo'],
    }
    api('/company-api/action?action=hire&req=' + encodeURIComponent(JSON.stringify(req)))
      .then(function (d) { $('hireMsg').textContent = d.ok ? ('✅ 已招聘 ' + req.id + ' → ' + (d.dir || '')) : ('❌ ' + (d.error || '失败')) })
      .catch(function (e) { $('hireMsg').textContent = '❌ ' + e.message })
  }
```

- [ ] **Step 2: canvas.html 顶栏招聘按钮挂 onclick**

把 `<span class="btn amber">＋ 招聘部门</span>` 替换为 `<span class="btn amber" onclick="window.openHire()">＋ 招聘部门</span>`。

- [ ] **Step 3: 提交**

```bash
git add presets/software-company/packages/company-r2/web/
git commit -m "feat(hire): 画布招聘面板（三步表单 + 授权提示）"
```

## Task 25: P2 验收（V5）

**Files:** 无（验证任务）

- [ ] **Step 1: 同步 + 新会话**

```bash
rsync -a presets/software-company/ ~/.dsh/.agent-presets/software-company/   # 需授权
```

- [ ] **Step 2: 招聘**

画布点「＋ 招聘部门」→ 填 `qa-auto` / 自动化测试部 → 招聘（批准授权）
Expected: 事件流 `dept.hired`；`ls ~/.dsh/.agent-presets/company-dept-qa-auto/` 有 agent.cordis.yml

- [ ] **Step 3: 注册生效** —— roles.json 出现 qa-auto 且 `source: 'hired'`
- [ ] **Step 4: 派工** —— `company_adjust_flow` 插 qa-auto 环节 → 派工：子代理按新 preset 运行（无 company_* 工具）
- [ ] **Step 5: 撤销** —— `curl -s "http://127.0.0.1:3080/company-api/action?action=undoHire&id=qa-auto"` → `{"ok":true}`；roles.json 移除；目录归档
- [ ] **Step 6: 提交验收记录**

```bash
git add -A .company-harness && git commit -m "test(hire): P2 V5 招聘/派工/撤销验收记录"
```

---

# Part P3 · 验收与收尾

## Task 26: 五场景验收 + 破坏性暂停验证

**Files:** 无（验证任务；记录写 `.company-harness/acceptance/`）

- [ ] **Step 1: 场景① 小型 UI 修改** —— 「公司模式：把首页按钮颜色改成蓝色」→ 发布；小型模板 + 确定性徽章 + contracts/ 契约生成
- [ ] **Step 2: 场景② 中型持久化功能** —— 「公司模式：给待办应用加 localStorage 持久化」→ 发布；explorer 缓存文件生成；无 final-evaluator 环节
- [ ] **Step 3: 场景③ 多模块并行（V1 复核）** —— 复杂任务三路并行→汇聚→QA→终验→发布；画布全链路可见；三份契约签收齐全
- [ ] **Step 4: 场景④ 注入式 QA 失败** —— 故意写错验收点 → FAIL → Repair Generator 全新上下文；报告只带 diff+失败断言+最小复现
- [ ] **Step 5: 场景⑤ 并发文件所有权冲突** —— 两部门声明重叠所有权 → OWNERSHIP_CONFLICT → ⚖ 决策 → 暂停/恢复
- [ ] **Step 6: 破坏性操作自动暂停** —— 部门越权删除操作 → 引擎拦截 PAUSED → 胶囊红点
- [ ] **Step 7: V7 token 对比** —— 场景③ COST_LEDGER vs 改造前同规模任务；降幅 ≥ 20%，记录数字
- [ ] **Step 8: Safari 全流程** —— 无崩溃、无 "Failed to load plugins"、shell.overlay 无异常
- [ ] **Step 9: 提交**

```bash
mkdir -p .company-harness/acceptance && git add .company-harness/acceptance && git commit -m "test: P3 五场景+破坏性暂停验收报告"
```

## Task 27: 更新 SKILL.md 与文档

**Files:**
- Modify: `~/.dsh/skills/software-company/SKILL.md`（需授权；不存在则创建）
- Modify: `presets/software-company/roles/ROLES.md`（仓库副本）

- [ ] **Step 1: 检查**

Run: `ls ~/.dsh/skills/software-company/ 2>/dev/null || echo 不存在`

- [ ] **Step 2: SKILL.md 追加 v2 章节**

```markdown
## v2 总监可视化（2026-08-16）
- 任务拥有 DAG 流程（RUN_STATE.flow：nodes/needs/done/adjustments）；旧任务回退 17 步线性视图。
- 交接一律用契约三件套（模块图/API 签名/非目标）落 tasks/<TASK>/contracts/，签收走 handoff.signed 事件。
- 事件流 .company-harness/events/events.jsonl 是画布唯一数据源（seq 增量）。
- 总监画布：http://127.0.0.1:3080/company —— 拖动节点、悬停信息卡、审批（🔔）、决策（⚖）、并发上限、招聘部门。
- 五刀：coordinator 只做裁决（瞬时 max 子代理）；recorder 代码化；确定性断言脚本化；explorer/qa-runner=medium、mechanical-worker/recorder=low；复杂任务并发默认 2。
- 新工具：company_adjust_flow / company_run_sprint / company_hire_department / company_upgrade_department。
```

- [ ] **Step 3: 提交**

```bash
git add presets/software-company/roles/ROLES.md && git commit -m "docs: SKILL.md 增补 v2 章节"
```

## Task 28: 收尾检查清单

**Files:** 无

- [ ] **Step 1: 全量单测**

Run: `cd presets/software-company/packages/company-r2 && npm test --silent 2>&1 | tail -3`
Expected: 全部 PASS

- [ ] **Step 2: 注册契约检查**

Run: `tail -6 presets/software-company/packages/company-r2/client.js`
Expected: `__ModuleLoader__.load` 注册块原样

- [ ] **Step 3: git 状态**

```bash
git status --short && git log --oneline -8
```

- [ ] **Step 4: 完成报告（发给用户）**

汇总：实现功能、V1–V7 验收结果、token 节省对比、遗留观察项。
