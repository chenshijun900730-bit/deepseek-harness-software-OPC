# 画布出厂动效 + 默认锁定当前会话 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布每次打开先播「出厂动效」，动效期间定位当前会话；动效结束后只加载当前会话的任务/派工/用量，别的会话数据不再默认可见（保留「🏢 全部」手动入口）。

**Architecture:** 纯函数口径逻辑进 `lib/usage.js`（可单测）；`host.js` 的 `canvasSnapshot`/`sessionsSnapshot` 加字段并按 scope 统计；`canvas.html` 加 boot 覆盖层与中性化顶栏；`canvas.js` 加 boot 状态机、五级 scope 决策与客户端空态。验证用现有 `node --test` + 新增 CDP 冒烟脚本。

**Tech Stack:** 原生 Node（`node:test`）、零依赖浏览器 JS、headless Chrome CDP（冒烟）。

**规格:** `docs/superpowers/specs/2026-08-17-canvas-boot-scope-design.md`

---

## 文件结构

- `presets/software-company/packages/company-r2/lib/usage.js` — 新增 3 个纯函数（scope 过滤、被调用统计、token 合计）。
- `presets/software-company/packages/company-r2/tests/scope.test.js` — 新单测（新建）。
- `presets/software-company/packages/company-r2/host.js` — `sessionsSnapshot` 透出 `live`；`canvasSnapshot` 按 scope 统计并保留全项目字段。
- `presets/software-company/packages/company-r2/web/canvas.html` — boot 覆盖层、顶栏数字中性化、空态提示条。
- `presets/software-company/packages/company-r2/web/canvas.js` — boot 状态机、scope 决策、空态、cap-pill 动态数字。
- `presets/software-company/packages/company-r2/tests/smoke-boot.mjs` — CDP 冒烟脚本（新建）。

---

## Task 1: lib/usage.js 三个纯函数（TDD）

**Files:**
- Modify: `presets/software-company/packages/company-r2/lib/usage.js`
- Test: `presets/software-company/packages/company-r2/tests/scope.test.js`（新建）

- [ ] **Step 1: 写失败测试**

创建 `presets/software-company/packages/company-r2/tests/scope.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { filterAttributedByScope, everCallCountsOf, sumTokens } from '../lib/usage.js'

const attributed = [
  { taskId: 'T1', project: '/p1', department: 'be', sessionId: 's-be', totalTokens: 1000 },
  { taskId: 'T2', project: '/p2', department: 'fe', sessionId: 's-fe', totalTokens: 400 },
  { taskId: null, department: 'coordinator', sessionId: 's-root', totalTokens: 600 },
  { taskId: null, department: 'coordinator', sessionId: 's-other', totalTokens: 9999 },
]

test('filterAttributedByScope 命中子代理行与归属主会话行', () => {
  const out = filterAttributedByScope(attributed, new Set(['/p1\u0000T1']), new Set(['s-root']))
  assert.equal(out.length, 2)
  assert.equal(out[0].department, 'be')
  assert.equal(out[1].sessionId, 's-root')
})

test('filterAttributedByScope 排除其他任务与其他主会话', () => {
  const out = filterAttributedByScope(attributed, new Set(['/p1\u0000T1']), new Set(['s-root']))
  assert.ok(!out.some((a) => a.taskId === 'T2' || a.sessionId === 's-other'))
})

test('everCallCountsOf 统计调用次数与部门列表', () => {
  const { counts, depts } = everCallCountsOf([
    { department: 'be' }, { department: 'be' }, { department: 'fe' }, { department: null }, {},
  ])
  assert.deepEqual(counts, { be: 2, fe: 1 })
  assert.deepEqual(depts.sort(), ['be', 'fe'])
})

test('sumTokens 合计归属行 token', () => {
  assert.equal(sumTokens(attributed), 11999)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd presets/software-company/packages/company-r2 && node --test tests/scope.test.js`
Expected: FAIL，`SyntaxError: The requested module '../lib/usage.js' does not provide an export named 'filterAttributedByScope'`

- [ ] **Step 3: 实现三个纯函数**

在 `presets/software-company/packages/company-r2/lib/usage.js` 末尾追加：

```js
// 按 scope 过滤归属行：子代理行按 taskKey(project\taskId) 命中；
// 主会话行（taskId 为 null）按 sessionId 命中（本会话任务的主会话）。
export function filterAttributedByScope(attributed, taskKeys, sessionIds) {
  const out = []
  for (const a of attributed || []) {
    if (a.taskId && taskKeys.has(a.project + '\u0000' + a.taskId)) out.push(a)
    else if (!a.taskId && sessionIds.has(a.sessionId)) out.push(a)
  }
  return out
}

// 派工记录的「被调用过」口径：部门 → 调用次数（counts）与有调用的部门列表（depts）。
export function everCallCountsOf(dispatches) {
  const counts = {}
  for (const d of dispatches || []) {
    if (!d.department) continue
    counts[d.department] = (counts[d.department] || 0) + 1
  }
  return { counts, depts: Object.keys(counts) }
}

// 归属行 token 合计（scope 内总消耗口径）。
export function sumTokens(attributed) {
  return (attributed || []).reduce((s, a) => s + (a.totalTokens || 0), 0)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd presets/software-company/packages/company-r2 && node --test tests/scope.test.js`
Expected: PASS（4/4）

- [ ] **Step 5: 提交**

```bash
git add presets/software-company/packages/company-r2/lib/usage.js presets/software-company/packages/company-r2/tests/scope.test.js
git commit -m "feat(company): scope 口径纯函数（过滤/被调用统计/token 合计）+ 单测"
```

---

## Task 2: sessionsSnapshot 透出 live 标记

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js:327`

> 说明：`sessionsSnapshot` 是 `apply(ctx)` 内的闭包函数，需要 ctx 模拟才能单测；此改动是一行字段透传（`meta.live` 已有），由 Task 6 CDP 冒烟覆盖，不单独建单测。

- [ ] **Step 1: 修改行**

将 `presets/software-company/packages/company-r2/host.js` 第 327 行：

```js
        rows.push({ sessionId: g.sessionId, title, cwd, taskCount: g.tasks, taskIds: g.taskIds, project: g.project })
```

改为：

```js
        rows.push({ sessionId: g.sessionId, title, cwd, taskCount: g.tasks, taskIds: g.taskIds, project: g.project, live: meta ? !!meta.live : false })
```

- [ ] **Step 2: 语法检查**

Run: `cd presets/software-company/packages/company-r2 && node --check host.js`
Expected: 无输出（通过）

- [ ] **Step 3: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js
git commit -m "feat(company): 会话清单透出 live 标记"
```

---

## Task 3: canvasSnapshot 按 scope 统计待命/总量

**Files:**
- Modify: `presets/software-company/packages/company-r2/host.js:4,1244-1305`

- [ ] **Step 1: 扩展 import**

`host.js` 第 4 行：

```js
import { attributeUsage, aggregateByDepartment } from './lib/usage.js'
```

改为：

```js
import { attributeUsage, aggregateByDepartment, filterAttributedByScope, everCallCountsOf, sumTokens } from './lib/usage.js'
```

- [ ] **Step 2: 全项目被调用口径改存 *All 字段**

将 `host.js` 中这段（约 1244-1251 行）：

```js
      // 全时全项目「被调用过」口径：在 scope 过滤之前基于全量 dispatches 统计，
      // 供画布「蓝色待命」状态与「调用×N」计数使用（不受 scope 与 60 条窗口影响）。
      const everCallCounts = {}
      for (const d of dispatches) {
        if (!d.department) continue
        everCallCounts[d.department] = (everCallCounts[d.department] || 0) + 1
      }
      const everCalledDepts = Object.keys(everCallCounts)
```

替换为：

```js
      // 全项目「被调用过」口径（「🏢 全部」视图使用）：基于全量 dispatches 统计。
      const allEver = everCallCountsOf(dispatches)
      const everCallCountsAll = allEver.counts
      const everCalledDeptsAll = allEver.depts
```

- [ ] **Step 3: scope 内统计（待命 + 归属 + 总量）**

将 `host.js` 中这段（约 1256-1260 行）：

```js
      const ids = await scopedTaskIds(scope, allTasks)
      const tasks = ids ? allTasks.filter(function (t) { return ids.has(taskKey(t.project, t.taskId)) }) : allTasks
      // 会话隔离：部门聚合/活跃部门/调用明细/总量都只算该会话任务归属的部分
      const scopedAttributed = ids ? attributed.filter(function (a) { return !a.taskId || ids.has(taskKey(a.project, a.taskId)) }) : attributed
      const depts = aggregateByDepartment(scopedAttributed)
```

替换为：

```js
      const ids = await scopedTaskIds(scope, allTasks)
      const tasks = ids ? allTasks.filter(function (t) { return ids.has(taskKey(t.project, t.taskId)) }) : allTasks
      // 会话隔离：部门聚合/活跃部门/调用明细/总量都只算该会话任务归属的部分。
      // 主会话行（taskId=null）按 scopedSessionIds 归属，别的会话根 token 不再混入。
      const scopedSessionIds = new Set(tasks.map(function (t) { return t.sessionId }).filter(Boolean))
      const scopedAttributed = ids
        ? filterAttributedByScope(attributed, ids, scopedSessionIds)
        : attributed
      const depts = aggregateByDepartment(scopedAttributed)
      // 部门「待命」口径随 scope：有 scope 时只统计本会话任务的派工；
      // 全项目口径保留在 *All 字段（「全部」视图使用）。
      const scopedDispatches = ids
        ? dispatches.filter(function (d) { return !d.taskId || ids.has(taskKey(d.project, d.taskId)) })
        : dispatches
      const scopedEver = everCallCountsOf(scopedDispatches)
      const everCallCounts = scopedEver.counts
      const everCalledDepts = scopedEver.depts
```

- [ ] **Step 4: 返回块增加字段**

将 `host.js` 中这段（约 1297-1304 行）：

```js
      return {
        tasks: tasks.map(function (t) { return { taskId: t.taskId, status: t.status, type: t.type, requirement: (t.requirement || '').slice(0, 120) } }),
        depts, dispatchDepts, roles, dispatches: callList.slice(-500),
        everCalledDepts, everCallCounts,
        totalTokens: allRows.reduce(function (s, r) { return s + (r.totalTokens || 0) }, 0),
        totalSurface: allRows.reduce(function (s, r) { return s + (r.surfaceTokens || 0) }, 0),
        concurrency: CONCURRENCY.limit || 3,
        at: now(),
      }
```

替换为：

```js
      return {
        tasks: tasks.map(function (t) { return { taskId: t.taskId, status: t.status, type: t.type, requirement: (t.requirement || '').slice(0, 120) } }),
        depts, dispatchDepts, roles, dispatches: callList.slice(-500),
        everCalledDepts, everCallCounts,
        everCalledDeptsAll, everCallCountsAll,
        totalTokens: ids ? sumTokens(scopedAttributed) : allRows.reduce(function (s, r) { return s + (r.totalTokens || 0) }, 0),
        totalTokensAll: allRows.reduce(function (s, r) { return s + (r.totalTokens || 0) }, 0),
        totalSurface: allRows.reduce(function (s, r) { return s + (r.surfaceTokens || 0) }, 0),
        concurrency: CONCURRENCY.limit || 3,
        at: now(),
      }
```

- [ ] **Step 5: 语法检查 + 全量单测**

Run: `cd presets/software-company/packages/company-r2 && node --check host.js && node --test tests/*.test.js`
Expected: 无输出 + 全部 PASS（含 Task 1 新增 4 项）

- [ ] **Step 6: 提交**

```bash
git add presets/software-company/packages/company-r2/host.js
git commit -m "feat(company): canvasSnapshot 待命/总量随 scope 统计并保留全项目字段"
```

---

## Task 4: canvas.html —— boot 覆盖层 + 顶栏中性化 + 空态提示

**Files:**
- Modify: `presets/software-company/packages/company-r2/web/canvas.html`

- [ ] **Step 1: `.app` 加 position:relative**

第 4 行：

```html
  .app { width:1712px; background:#0b0f19; border:1px solid #1f2937; border-radius:14px; overflow:hidden;
         font-family:system-ui,sans-serif; color:#e5e7eb; }
```

改为：

```html
  .app { position:relative; width:1712px; background:#0b0f19; border:1px solid #1f2937; border-radius:14px; overflow:hidden;
         font-family:system-ui,sans-serif; color:#e5e7eb; }
```

- [ ] **Step 2: 新增 boot 动效 CSS**

在 `<style>` 结束标签 `</style>` 前插入：

```css
  .boot-overlay { position:absolute; inset:0; background:#0b0f19; z-index:90; display:flex; flex-direction:column;
                  align-items:center; justify-content:center; gap:14px; transition:opacity .5s ease; }
  .boot-logo { font-size:44px; animation:bootBreath 1.6s ease-in-out infinite; }
  @keyframes bootBreath { 0%,100% { transform:scale(1); opacity:.75; } 50% { transform:scale(1.12); opacity:1; } }
  .boot-title { font-size:13px; color:#9ca3af; letter-spacing:1px; }
  .boot-skel { border-radius:5px; background:#1f2937; animation:bootPulse 1.6s ease-in-out infinite; }
  @keyframes bootPulse { 0%,100% { opacity:.2; } 50% { opacity:.55; } }
```

- [ ] **Step 3: cap-pill 数字改为动态占位**

第 74 行：

```html
    <span class="cap-pill">🏢 Company · 3 项目 · ⚙ 2 工作中 · ⚡ <span id="capTok">1.24M</span> · <span style="color:#f87171;">🔴 1</span></span>
```

改为：

```html
    <span class="cap-pill">🏢 Company · <span id="capProjects">-</span> 项目 · ⚙ <span id="capWorking">-</span> 工作中 · ⚡ <span id="capTok">-</span></span>
```

- [ ] **Step 4: token 总量默认中性化并移除静态演示数字**

第 81 行：

```html
      <span>⚡ 总量 <b style="color:#f59e0b;" id="tokTotal">1.24M</b> · ⇧ 表面 <b style="color:#7dd3fc;" id="tokSurface" title="上下文表面：随流式输出实时增长">-</b> · 近1分 <b style="color:#86efac;" id="tokDelta" title="最近 60 秒 token 增量">+0</b> · 今日 +86k ↑
        <svg width="70" height="18" style="vertical-align:middle;"><polyline points="2,15 14,12 26,13 38,8 50,9 62,4" fill="none" stroke="#f59e0b" stroke-width="1.5"/></svg></span>
```

改为：

```html
      <span>⚡ 总量 <b style="color:#f59e0b;" id="tokTotal">-</b> · ⇧ 表面 <b style="color:#7dd3fc;" id="tokSurface" title="上下文表面：随流式输出实时增长">-</b> · 近1分 <b style="color:#86efac;" id="tokDelta" title="最近 60 秒 token 增量">+0</b></span>
```

- [ ] **Step 5: boot 覆盖层元素（`.app` 第一个子元素）**

在 `<div class="app">` 之后、`<div class="cap-strip">` 之前插入：

```html
  <div class="boot-overlay" id="bootOverlay">
    <div class="boot-logo">🏢</div>
    <div class="boot-title">公司启动中 · 正在定位当前会话…</div>
    <div class="boot-skel" style="width:520px;height:10px;"></div>
    <div class="boot-skel" style="width:380px;height:10px;"></div>
    <div class="boot-skel" style="width:300px;height:10px;"></div>
  </div>
```

- [ ] **Step 6: 空态提示条（engineBanner 之后）**

在 `engineBanner` div 结束后（约 98 行后）插入：

```html
  <div id="emptyHint" style="display:none;margin:10px 16px 0;padding:12px 16px;background:#111827;border:1px dashed #374151;border-radius:10px;font-size:12px;color:#9ca3af;">
    🏢 新公司 · 还没有会话（在对话里选 Software Company 模式并 company_start 后自动聚焦）
  </div>
```

- [ ] **Step 7: 占位文案同步**

第 110 行 `#nd-placeholder` 的文本改为：

```html
      <div id="nd-placeholder" style="position:absolute;left:230px;top:200px;color:#6b7280;font-size:12px;">🏢 新公司 · 还没有会话（在对话里选 Software Company 模式并 company_start 后自动聚焦）</div>
```

- [ ] **Step 8: 提交**

```bash
git add presets/software-company/packages/company-r2/web/canvas.html
git commit -m "feat(canvas): 出厂动效覆盖层 + 顶栏演示数字中性化 + 空态提示"
```

---

## Task 5: canvas.js —— boot 状态机 + 五级 scope 决策 + 空态 + cap-pill

**Files:**
- Modify: `presets/software-company/packages/company-r2/web/canvas.js`

> canvas.js 是浏览器 IIFE（无 DOM 测试框架），本任务验证靠 `node --check` + Task 6 冒烟。

- [ ] **Step 1: boot 状态与空态变量**

在 `var STATE = {...}` 声明之后（约第 6 行后）插入：

```js
  var BOOT = { phase: 'booting', minUntil: Date.now() + 1200, hardUntil: Date.now() + 2500, scopeResolved: false }
  var EMPTY = false
  var ACTIVE_STATUSES = ['CLASSIFIED', 'DISCOVERY', 'PRODUCT_PLANNED', 'WAITING_INITIAL_APPROVAL', 'SPRINT_DRAFTING', 'CONTRACT_REVIEW', 'CONTRACT_SIGNED', 'IMPLEMENTING', 'SELF_CHECK', 'INTEGRATING', 'QA_RUNNING', 'SPRINT_PASSED', 'REPAIRING', 'REPLANNING', 'FINAL_E2E', 'PAUSED']
```

- [ ] **Step 2: 角色兜底表（空态无 roles 数据时用）**

在 `function roleOf(id)` 之前插入：

```js
  var ROLE_FALLBACK = {
    'coordinator': { id: 'coordinator', title: 'Coordinator 项目总控', model: 'deepseek-v4-pro', reasoning: 'max' },
    'planner': { id: 'planner', title: 'Planner 产品经理', model: 'deepseek-v4-pro', reasoning: 'high' },
    'architect': { id: 'architect', title: '架构负责人', model: 'deepseek-v4-pro', reasoning: 'high' },
    'generator': { id: 'generator', title: '主程序员 Generator', model: 'deepseek-v4-pro', reasoning: 'high' },
    'department-generator': { id: 'department-generator', title: '部门程序员', model: 'deepseek-v4-pro', reasoning: 'high' },
    'integrator': { id: 'integrator', title: 'Integrator 集成负责人', model: 'deepseek-v4-pro', reasoning: 'high' },
    'sprint-evaluator': { id: 'sprint-evaluator', title: 'Sprint Evaluator', model: 'deepseek-v4-pro', reasoning: 'high' },
    'final-evaluator': { id: 'final-evaluator', title: '最终验收负责人', model: 'deepseek-v4-pro', reasoning: 'high' },
    'security-reviewer': { id: 'security-reviewer', title: '安全/数据迁移评审', model: 'deepseek-v4-pro', reasoning: 'high' },
    'explorer': { id: 'explorer', title: 'Explorer 调查员', model: 'deepseek-v4-flash', reasoning: 'medium' },
    'qa-runner': { id: 'qa-runner', title: 'QA 执行员', model: 'deepseek-v4-flash', reasoning: 'medium' },
    'mechanical-worker': { id: 'mechanical-worker', title: 'Mechanical Worker', model: 'deepseek-v4-flash', reasoning: 'low' },
    'recorder': { id: 'recorder', title: 'Recorder 项目秘书', model: 'deepseek-v4-flash', reasoning: 'low' },
    'repair-generator': { id: 'repair-generator', title: 'Repair Generator', model: 'deepseek-v4-pro', reasoning: 'high' },
  }
```

并将 `roleOf` 的兜底返回改为优先查 `ROLE_FALLBACK`：

```js
  function roleOf(id) {
    for (var i = 0; i < (STATE.roles || []).length; i++) if (STATE.roles[i].id === id) return STATE.roles[i]
    return ROLE_FALLBACK[id] || { id: id, title: id, model: '?', reasoning: '?' }
  }
```

- [ ] **Step 3: cap-pill 动态数字**

在 `function fmtFull` 之后插入：

```js
  function updateCapPill() {
    var p = $('capProjects')
    if (p) p.textContent = String((STATE.tasks || []).length)
    var w = $('capWorking')
    if (w) w.textContent = String((STATE.tasks || []).filter(function (t) { return ACTIVE_STATUSES.indexOf(t.status) >= 0 }).length)
  }
```

- [ ] **Step 4: scope 兜底函数**

在 `autoDetectScope` 函数之后插入：

```js
  // 兜底：没有任何父窗口信号时，聚焦会话清单里最近的存活会话（taskCount 大者优先）
  function resolveBootScope(sessions) {
    var live = (sessions || []).filter(function (s) { return s.live })
    if (!live.length) return false
    live.sort(function (a, b) { return (b.taskCount || 0) - (a.taskCount || 0) })
    STATE.scope = live[0].sessionId
    return true
  }
```

- [ ] **Step 5: __selectScope 与 postMessage 解除空态**

`__selectScope` 函数体开头插入空态解除：

```js
  window.__selectScope = function (id) {
    if (EMPTY) { EMPTY = false; var eh = $('emptyHint'); if (eh) eh.style.display = 'none' }
    STATE.scope = id || null
```

postMessage 处理器中，在 `if (sid === STATE.scope) return` 之后插入：

```js
    if (EMPTY) { EMPTY = false; var ehh = $('emptyHint'); if (ehh) ehh.style.display = 'none' }
```

- [ ] **Step 6: poll 重构（空态短路 + 会话刷新抽函数）**

将 `function poll() { ... }` 与底部 `setInterval(poll, 1000); poll()` 整体替换为：

```js
  function refreshSessions() {
    api('/company-api/sessions').then(function (d) {
      STATE.sessions = Array.isArray(d) ? d : []
      if (BOOT.phase === 'booting') {
        if (STATE.scope === null) {
          if (autoDetectScope(STATE.sessions)) BOOT.scopeResolved = true
          else if (resolveBootScope(STATE.sessions)) BOOT.scopeResolved = true
          else EMPTY = true
        } else BOOT.scopeResolved = true
      } else if (EMPTY) {
        // 空态等待第一个公司会话出现：自动聚焦并恢复数据渲染
        var live = STATE.sessions.filter(function (s) { return s.live })
        if (live.length) {
          EMPTY = false
          STATE.scope = live[0].sessionId
          STATE.scopeChosen = false
          var h = $('emptyHint'); if (h) h.style.display = 'none'
          resetEventCursor()
        }
      }
      var changed = autoDetectScope(STATE.sessions)
      renderScopeChips()
      if (BOOT.phase === 'ready' && changed && !EMPTY) poll()
      finishBootIfReady()
    }).catch(function () { finishBootIfReady() })
  }
  function poll() {
    if (EMPTY) { refreshSessions(); return }
    api('/company-api/events?since=' + encodeURIComponent(STATE.since) + scopeQuery()).then(function (d) {
      /* 原事件处理逻辑原样保留 */
    }).catch(function () {})
    if (!canvasFetchPending) {
      api('/company-api/canvas' + (STATE.scope ? '?scope=' + encodeURIComponent(STATE.scope) : ''), 6000).then(function (d) {
        canvasFetchPending = false
        showEngineDown(false)
        /* 原数据装载逻辑原样保留，并在 renderChips() 之后加一行 updateCapPill() */
      }).catch(function (e) { /* 原错误处理原样保留 */ })
    }
    refreshSessions()
  }
```

> 实施时**不得用注释代替原逻辑**：把现有 `poll()` 里的事件段、canvas 段、catch 段代码原样搬入上面的占位处；仅做两处实际改动——(a) 函数入口加 `if (EMPTY) { refreshSessions(); return }`，(b) canvas 成功段 `renderChips()` 后加 `updateCapPill()`，(c) 原 sessions 块删除、换成 `refreshSessions()`。

- [ ] **Step 7: boot 收尾函数 + 启动编排**

在 `window.__openCoord` 之前插入：

```js
  function finishBootIfReady() {
    if (BOOT.phase !== 'booting') return
    var nowT = Date.now()
    if (!(nowT >= BOOT.minUntil && (BOOT.scopeResolved || EMPTY || nowT >= BOOT.hardUntil))) return
    BOOT.phase = 'ready'
    var ov = $('bootOverlay')
    if (ov) { ov.style.opacity = '0'; setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov) }, 500) }
    if (EMPTY) {
      var h = $('emptyHint'); if (h) h.style.display = 'block'
      renderChips(); updateCapPill(); renderOrg()
    }
    poll()
    setInterval(poll, 1000)
  }
  BOOT.scopeResolved = STATE.scope !== null
  refreshSessions()
  setInterval(function () { if (BOOT.phase === 'booting') finishBootIfReady() }, 100)
```

- [ ] **Step 8: 语法检查**

Run: `cd presets/software-company/packages/company-r2 && node --check web/canvas.js`
Expected: 无输出（通过）

- [ ] **Step 9: 提交**

```bash
git add presets/software-company/packages/company-r2/web/canvas.js
git commit -m "feat(canvas): boot 状态机 + 默认锁定当前会话 + 空态 + cap-pill 动态数字"
```

---

## Task 6: CDP 冒烟脚本 + 实测

**Files:**
- Create: `presets/software-company/packages/company-r2/tests/smoke-boot.mjs`

- [ ] **Step 1: 写冒烟脚本**

```js
#!/usr/bin/env node
/* 冒烟：画布出厂动效 + 空态。用法：node tests/smoke-boot.mjs <画布URL> [scopeSessionId]
 * 校验：0.5s 内 boot 覆盖层可见且无部门卡；3.5s 后覆盖层消失；空态提示或数据卡二选一；
 *       传 scopeSessionId 时校验任务 chip 只含该会话（title 匹配留给人工）。
 * 依赖：系统 Chrome（--no-sandbox，宿主沙箱环境必须）；Node >= 22（原生 WebSocket）。
 */
import { spawn } from 'node:child_process'
import http from 'node:http'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9340
const PROFILE = '/tmp/smoke-boot-profile'
const URL = process.argv[2]
const SCOPE = process.argv[3] || ''
if (!URL) { console.error('usage: node tests/smoke-boot.mjs <url> [scopeSessionId]'); process.exit(2) }

function httpJson(method, url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method }, (res) => {
      let data = ''; res.on('data', (c) => (data += c))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(new Error('bad json')) } })
    })
    req.on('error', reject); req.end()
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail: detail || '' }); console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' · ' + detail : '')) }

const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-crashpad','--disable-breakpad','--disable-dev-shm-usage','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'--no-first-run','--disable-extensions','--remote-allow-origins=*','about:blank'], { stdio: 'ignore' })
const kill = () => { try { chrome.kill('SIGKILL') } catch (e) {} }
process.on('exit', kill)

let version = null
for (let i = 0; i < 60; i++) { try { version = await httpJson('GET', `http://127.0.0.1:${PORT}/json/version`); break } catch (e) { await sleep(250) } }
if (!version) { console.error('Chrome CDP 未就绪'); process.exit(1) }
const page = URL + (SCOPE ? (URL.indexOf('?') >= 0 ? '&' : '?') + 'scope=' + encodeURIComponent(SCOPE) : '')
let target
try { target = await httpJson('PUT', `http://127.0.0.1:${PORT}/json/new?` + encodeURIComponent(page)) }
catch (e) { target = await httpJson('GET', `http://127.0.0.1:${PORT}/json/new?` + encodeURIComponent(page)) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0; const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) } }
const send = (method, params) => new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : undefined }

await send('Runtime.enable', {})
await sleep(500)
check('boot 覆盖层在 0.5s 时可见', await evalJs(`(() => { const o = document.getElementById('bootOverlay'); return !!o && o.style.opacity !== '0' })()`))
check('boot 期间无部门底卡', await evalJs(`document.querySelectorAll('.nd[id^="nd-dept-"]').length === 0`))
check('boot 期间无任务 chip', await evalJs(`document.querySelectorAll('#chips .chip').length === 0`))
await sleep(3200)
check('3.7s 后覆盖层已移除', await evalJs(`!document.getElementById('bootOverlay')`))
const state = await evalJs(`(() => {
  const eh = document.getElementById('emptyHint')
  const cards = document.querySelectorAll('.nd[id^="nd-dept-"]').length
  const chips = document.querySelectorAll('#chips .chip').length
  return { empty: !!(eh && eh.style.display === 'block'), cards, chips,
           chipTexts: Array.from(document.querySelectorAll('#chips .chip')).map(c => c.textContent).slice(0, 8) }
})()`)
if (SCOPE) {
  check('指定 scope 后出现任务 chip（或空态提示）', state.chips > 0 || state.empty, JSON.stringify(state.chipTexts))
} else {
  check('空态提示或部门底卡出现', state.empty || state.cards === 14, 'empty=' + state.empty + ' cards=' + state.cards)
}
kill()
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? ('SMOKE FAILED: ' + failed.map((f) => f.name).join('; ')) : 'SMOKE PASSED')
process.exit(failed.length ? 1 : 0)
```

- [ ] **Step 2: 语法检查**

Run: `cd presets/software-company/packages/company-r2 && node --check tests/smoke-boot.mjs`
Expected: 无输出（通过）

- [ ] **Step 3: 同步 preset 到 rc.6 测试实例并重启它（不动 3080）**

```bash
TR="/Users/xiaowanzi/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a82791decf5f81cb3082bee/dsh-test"
cp presets/software-company/packages/company-r2/web/canvas.html "$TR/clean-home/.dsh/.agent-presets/software-company/packages/company-r2/web/canvas.html"
cp presets/software-company/packages/company-r2/web/canvas.js   "$TR/clean-home/.dsh/.agent-presets/software-company/packages/company-r2/web/canvas.js"
cp presets/software-company/packages/company-r2/host.js         "$TR/clean-home/.dsh/.agent-presets/software-company/packages/company-r2/host.js"
# 重启 14080 的 dsh web 进程（测试实例专用；3080 是当前会话宿主，禁止重启）
```

> 注：`$TR` 在会话工作区之外，文件同步会被沙箱拦截，按策略用更宽模式重试一次（需用户批准）。
> 注：同步到 `~/.dsh`（3080 实例）需要重启 web 服务才能让 host.js 生效，而重启会杀死当前对话，故 3080 的同步/重启**留给用户自己执行**（按 INSTALL.md「修改 preset 后必须真正重启」）。

- [ ] **Step 4: 跑冒烟（空态路径）**

Run: `cd presets/software-company/packages/company-r2 && node tests/smoke-boot.mjs http://127.0.0.1:14080/company`
Expected: 全部 PASS，末行 `SMOKE PASSED`（14080 无会话 → 走空态：0.5s 覆盖层可见、无底卡、3.7s 后覆盖层消失、空态提示显示、14 张灰色底卡）。

- [ ] **Step 5: 跑冒烟（scope 路径，需先在 14080 建一个公司会话）**

前置：在 14080 UI 里配置 API Key、新建会话（默认 Software Company 模式）、发送一条需求触发 `company_start`；从 `/company-api/sessions` 拿到该会话 sessionId。
Run: `cd presets/software-company/packages/company-r2 && node tests/smoke-boot.mjs http://127.0.0.1:14080/company <sessionId>`
Expected: 全部 PASS；任务 chip 只含该会话的任务；其他会话任务的调用卡/待命不出现。

- [ ] **Step 6: 提交**

```bash
git add presets/software-company/packages/company-r2/tests/smoke-boot.mjs
git commit -m "test(canvas): 出厂动效/scope 隔离 CDP 冒烟脚本"
```

---

## Task 7: 收尾回归

- [ ] **Step 1: 全量单测**

Run: `cd presets/software-company/packages/company-r2 && node --test tests/*.test.js`
Expected: 全部 PASS（原有 19 项 + 新增 4 项，共 23 项）

- [ ] **Step 2: 手动验收清单（14080 实例）**

- [ ] 打开 `/company`：先见动效（🏢 呼吸 + 「公司启动中」），约 1.2s 后淡出；
- [ ] 会话内打开（面板 iframe）：只见当前会话任务 chip / 调用卡 / 蓝色待命；别的会话数据不出现；
- [ ] 首页打开：空态提示 + 14 张灰色底卡，无任何其他会话数据；
- [ ] 手动点「🏢 全部」：全项目口径恢复（含 *All 字段数据）；
- [ ] 侧栏切换会话：即时跟随、不重播动效；
- [ ] 引擎未挂载：动效结束后显示既有横幅。

- [ ] **Step 3: 交付说明**

完成时向用户说明：3080（当前 GUI）需自行同步 preset 并重启 web 服务才能看到新行为；重启前先结束当前对话。

---

## Self-Review 记录

- **Spec 覆盖**：§2 时间线→Task 5/6；§3 canvas.html→Task 4；§4.1 boot→Task 5 Step 1/6/7；§4.2 五级 scope→Task 5 Step 4/6 + Task 2；§4.3 空态→Task 4 Step 6 + Task 5 Step 6；§5.1 live→Task 2；§5.2 口径→Task 1/3；§6 错误处理→Task 5（catch 保留原逻辑）+ Task 6 冒烟；§7 测试→Task 1/6/7。无遗漏。
- **占位符扫描**：Task 5 Step 6 明确要求「原样搬入现有逻辑」，其余步骤均含完整代码。
- **类型一致**：`filterAttributedByScope`/`everCallCountsOf`/`sumTokens` 在 Task 1 定义、Task 3 按同名导入调用；`everCallCountsAll`/`everCalledDeptsAll`/`totalTokensAll` 在 Task 3 返回、Task 6 由「全部」chip 触发读取（现有 canvas 读 `everCallCounts` 字段，scope 模式自动生效）。
