// 软件公司 Harness 面板（宿主平面包）：
// 只提供 /company-api 路由（只读面板数据 + 批准/暂停/恢复/终止操作）与浏览器胶囊。
// 不注册任何 company_* 工具、不注入公司协议段——那些留在 software-company 预置（会话平面）。
// 与预置内 company-r2 行并存时：/company-api 路由先到先得（预置侧有 try/catch 容忍），
// 子代理日志采用文件级去重，避免两实例重复写行。
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

export default {
  name: 'software-company-panel',
  inject: ['fs', 'timer', 'webServer'],
  apply(ctx) {
    const fsService = ctx.fs
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const TERMINAL_STATES = ['RELEASED', 'TERMINATED']
    function now() { return new Date().toISOString() }
    function fnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return ('00000000' + h.toString(16)).slice(-8) }
    async function resolveAbs(path) { const t = await fsService.resolve(path); return fsService.processPath(t) }
    function callSession() { try { const agents = ctx.get('agents'); const a = agents ? agents.currentInitiator() : undefined; if (a && a.session) return a.session } catch (e) {} return undefined }
    function writePolicyFor(abs) {
      if (!sandboxPolicy) return undefined
      try { const session = callSession(); if (session !== undefined) return sandboxPolicy.resolve({ session }) } catch (e) {}
      try { const base = sandboxPolicy.resolve(); const s = String(abs || ''); const idx = s.indexOf('/.company-harness/'); if (idx > 0 && base && base.mode === 'workspace-write') return { mode: 'workspace-write', workspaceRoot: s.slice(0, idx) }; return base } catch (e) {}
      return undefined
    }
    async function defaultProjectDir() {
      try { const session = callSession(); if (session && session.header && typeof session.header.cwd === 'string' && session.header.cwd) return session.header.cwd } catch (e) {}
      try { const ws = ctx.get('workspaceRegistry'); const list = ws ? ws.list() : undefined; if (list && list.length && list[0] && typeof list[0].path === 'string' && list[0].path) return list[0].path } catch (e) {}
      if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot) return sandboxPolicy.workspaceRoot
      return await resolveAbs('.')
    }
    async function readTextAt(abs) { const t = await fsService.resolve(abs); const info = await fsService.stat(t); if (!info || info.type !== 'file') return undefined; return await fsService.readText(t) }
    async function writeTextAt(abs, content) { await fsService.writeText(await fsService.resolve(abs), content, undefined, undefined, writePolicyFor(abs)) }
    async function appendTextAt(abs, content) { const old = await readTextAt(abs); await writeTextAt(abs, (old === undefined ? '' : old + '\n') + content) }
    async function readJsonAt(abs) { const s = await readTextAt(abs); if (s === undefined) return undefined; try { return JSON.parse(s) } catch (e) { return undefined } }
    async function writeJsonAt(abs, value) { await writeTextAt(abs, JSON.stringify(value, null, 2)) }
    async function allWorkspaceDirs() {
      const dirs = []
      try { const ws = ctx.get('workspaceRegistry'); const list = ws ? ws.list() : undefined; if (list) { for (const w of list) { if (w && typeof w.path === 'string' && dirs.indexOf(w.path) < 0) dirs.push(w.path) } } } catch (e) {}
      try { const d = await defaultProjectDir(); if (dirs.indexOf(d) < 0) dirs.push(d) } catch (e) {}
      return dirs
    }
    async function projectList() {
      const seen = [await defaultProjectDir()]
      const reg = await readJsonAt(seen[0] + '/.company-harness/registry.json')
      if (reg && Array.isArray(reg.projects)) { for (const p of reg.projects) { if (seen.indexOf(p) < 0) seen.push(p) } }
      return seen
    }
    async function loadTask(taskId) {
      for (const p of await projectList()) {
        const s = await readJsonAt(p + '/.company-harness/tasks/' + taskId + '/RUN_STATE.json')
        if (s && s.taskId === taskId) return { state: s, dir: p + '/.company-harness/tasks/' + taskId }
      }
      return undefined
    }
    async function listAllTasks() {
      const out = []
      for (const p of await projectList()) {
        const t = await fsService.resolve(p + '/.company-harness/tasks')
        const info = await fsService.stat(t)
        if (!info || info.type !== 'directory') continue
        const entries = await fsService.listDir(t)
        for (const e of entries) {
          if (e.type !== 'directory') continue
          const s = await readJsonAt(p + '/.company-harness/tasks/' + e.name + '/RUN_STATE.json')
          if (!s || s.taskId !== e.name) continue
          out.push({ taskId: s.taskId, project: p, mode: s.mode, type: s.classification ? s.classification.type : 'unknown', status: s.status, currentSprint: s.currentSprint || null, sprintsDone: (s.sprints || []).filter(function (x) { return x.status === 'PASSED' }).length, sprintTotal: (s.sprints || []).length, repairs: (s.sprints || []).reduce(function (a, x) { return a + (x.repairAttempts || 0) }, 0) + (s.finalRepairs || 0), replans: s.replans || 0, updatedAt: s.updatedAt || null })
        }
      }
      out.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) })
      return out
    }
    async function taskDetail(taskId) {
      const r = await loadTask(taskId)
      if (!r) return { error: '任务不存在' }
      const s = r.state
      return { taskId: s.taskId, status: s.status, mode: s.mode, type: s.classification ? s.classification.type : null, requirement: s.requirement, currentSprint: s.currentSprint || null, history: (s.history || []).slice(-12), updatedAt: s.updatedAt }
    }
    async function saveState(r) { await writeJsonAt(r.dir + '/RUN_STATE.json', r.state) }
    async function transition(r, to, reason, refs) {
      const s = r.state
      s.history.push({ at: now(), from: s.status, to, reason, refs: refs || [r.dir + '/RUN_STATE.json'] })
      s.status = to
      s.updatedAt = now()
      await saveState(r)
    }
    async function handleAction(taskId, action) {
      const r = await loadTask(taskId)
      if (!r) return { ok: false, error: '任务不存在' }
      const s = r.state
      if (action === 'approve') {
        if (s.status !== 'WAITING_INITIAL_APPROVAL') return { ok: false, error: '仅 WAITING_INITIAL_APPROVAL 可批准（当前 ' + s.status + '）' }
        const specPath = r.dir + '/PRODUCT_SPEC.md'; const planPath = r.dir + '/SPRINT_PLAN.md'
        const specText = await readTextAt(specPath); const planText = await readTextAt(planPath)
        if (specText === undefined || planText === undefined) return { ok: false, error: '规格文件缺失' }
        if (/（待 Planner 填写）/.test(specText) || /（待填写）/.test(planText)) return { ok: false, error: '规格仍含「待填写」占位' }
        s.approvals.push({ at: now(), what: 'PRODUCT_SPEC.md + SPRINT_PLAN.md', by: 'user', source: 'user-ui', specChecksum: fnv1a(specText), planChecksum: fnv1a(planText) })
        await transition(r, 'SPRINT_DRAFTING', '用户通过 UI 面板批准产品规格与 Sprint 计划', [specPath, planPath])
        return { ok: true, status: s.status }
      }
      if (action === 'resume') {
        if (s.status !== 'PAUSED') return { ok: false, error: '仅 PAUSED 可恢复' }
        const back = s.pausedFrom || 'SPRINT_DRAFTING'
        await transition(r, back, '用户通过 UI 恢复', [r.dir + '/RUN_STATE.json'])
        s.pausedFrom = null
        await saveState(r)
        return { ok: true, status: s.status }
      }
      if (action === 'pause') {
        if (s.status === 'PAUSED' || TERMINAL_STATES.indexOf(s.status) >= 0) return { ok: false, error: '不可暂停' }
        const sprintId = s.currentSprint || (s.sprints && s.sprints.length ? s.sprints[s.sprints.length - 1].id : null)
        if (sprintId) {
          const handoff = r.dir + '/sprints/' + sprintId + '/HANDOFF.md'
          if (await readTextAt(handoff) === undefined) return { ok: false, error: '暂停前需 Recorder 刷新 HANDOFF.md' }
        }
        await transition(r, 'PAUSED', '用户通过 UI 暂停', [r.dir + '/RUN_STATE.json'])
        return { ok: true, status: s.status }
      }
      if (action === 'terminate') {
        if (TERMINAL_STATES.indexOf(s.status) >= 0) return { ok: false, error: '已终态' }
        await transition(r, 'TERMINATED', '用户通过 UI 终止', [r.dir + '/RUN_STATE.json'])
        return { ok: true, status: s.status }
      }
      return { ok: false, error: '未知操作' }
    }

    // ================= 子代理日志（跨工作区聚合 + 文件级去重）与模型解析 =================
    const agentLog = []
    let agentLogFlushChain = Promise.resolve()
    async function agentLogFile() { return (await defaultProjectDir()) + '/.company-harness/agents-log.jsonl' }
    async function loadAgentLog() {
      const seen = new Set()
      const gathered = []
      for (const p of await allWorkspaceDirs()) {
        try {
          const text = await readTextAt(p + '/.company-harness/agents-log.jsonl')
          const lines = (text || '').split('\n').filter(function (x) { return x.trim() !== '' })
          for (const l of lines.slice(-2000)) {
            try {
              const o = JSON.parse(l)
              if (!o || !o.kind) continue
              const key = String(o.at || '') + '|' + String(o.runId || '') + '|' + o.kind
              if (seen.has(key)) continue
              seen.add(key); gathered.push(o)
            } catch (e) {}
          }
        } catch (e) {}
      }
      gathered.sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')) })
      for (const o of gathered) agentLog.push(o)
    }
    loadAgentLog()
    function modelOfSession(session) {
      try {
        const h = session.requestHeader && session.requestHeader()
        if (h && h.config && h.config.model) return { provider: String(h.config.provider || ''), model: String(h.config.model) }
      } catch (e) {}
      try {
        const rc = session.requestContext && session.requestContext()
        if (rc && rc.model) return { provider: String(rc.provider || ''), model: String(rc.model) }
      } catch (e) {}
      return undefined
    }
    function modelOfInfo(info) {
      try {
        const agents = ctx.get('agents')
        const a = agents ? agents.get(info && info.id) : undefined
        if (a && a.session) return modelOfSession(a.session)
      } catch (e) {}
      return undefined
    }
    const persistedModelCache = new Map()
    function roleFromText(text) {
      const m = String(text || '').match(/的\s*([^（(，,。]+?)\s*(?:[（(，,。]|$)/)
      if (m && m[1] && m[1].trim() && m[1].trim().length <= 40) return m[1].trim()
      return ''
    }
    function firstTextFromEvents(events) {
      for (const e of events) {
        if (!e || !e.data) continue
        if (e.type === 'agent/inbox/spliced' && Array.isArray(e.data.inserted)) {
          for (const ins of e.data.inserted) {
            if (ins && Array.isArray(ins.content)) {
              for (const blk of ins.content) { if (blk && typeof blk.text === 'string' && blk.text.trim()) return blk.text }
            }
          }
        }
        if (e.type === 'user/message' && Array.isArray(e.data.content)) {
          for (const blk of e.data.content) { if (blk && typeof blk.text === 'string' && blk.text.trim()) return blk.text }
        }
      }
      return ''
    }
    async function resolvePersistedModel(sid) {
      try {
        const cached = persistedModelCache.get(sid)
        if (cached !== undefined && Date.now() - cached.at < 60000) { return cached.model ? { provider: cached.provider, model: cached.model, role: cached.role } : undefined }
        let found
        let role = ''
        try {
          const sessions = ctx.get('sessions')
          const live = sessions ? sessions.get(sid) : undefined
          if (live) found = modelOfSession(live)
        } catch (e) {}
        if (found === undefined || role === '') {
          const sq = ctx.get('sessionQuery')
          if (sq !== undefined) {
            const snap = await sq.readSession(sid)
            if (snap && Array.isArray(snap.events)) {
              if (role === '') role = roleFromText(firstTextFromEvents(snap.events))
              for (let i = snap.events.length - 1; i >= 0; i--) {
                const e = snap.events[i]
                if (found === undefined && e && e.type === 'request/context' && e.data && e.data.model) { found = { provider: String(e.data.provider || ''), model: String(e.data.model) } }
                if (found !== undefined && role !== '') break
              }
            }
          }
        }
        persistedModelCache.set(sid, { at: Date.now(), model: found ? found.model : '', provider: found ? found.provider : '', role })
        return found ? { provider: found.provider, model: found.model, role } : undefined
      } catch (e) { return undefined }
    }
    function rewriteAgentLog() {
      agentLogFlushChain = agentLogFlushChain.then(async function () {
        try { await writeTextAt(await agentLogFile(), agentLog.slice(-2000).map(function (x) { return JSON.stringify(x) }).join('\n') + '\n') } catch (e) {}
      })
    }
    async function enrichAgentLog() {
      let changed = false
      for (const e of agentLog) {
        if (e.model || !e.id) continue
        const mod = await resolvePersistedModel(e.id)
        if (mod) { e.model = mod.model; e.modelProvider = mod.provider; changed = true }
      }
      if (changed) rewriteAgentLog()
    }
    enrichAgentLog()
    function pushAgentLog(kind, info) {
      try {
        const model = modelOfInfo(info)
        const entry = { at: now(), kind, runId: String((info && info.runId) || ''), provider: String((info && info.provider) || ''), id: String((info && info.id) || ''), local: !!(info && info.local), model: model ? model.model : '', modelProvider: model ? model.provider : '', stopReason: kind === 'end' ? String((info && info.stopReason) || '') : null }
        // 与预置实例并存时的文件级去重：最后一行相同则跳过写入
        const key = JSON.stringify(entry)
        const inMemory = agentLog.some(function (x) { return x.kind === entry.kind && x.runId === entry.runId && x.at === entry.at })
        if (!inMemory) agentLog.push(entry)
        agentLogFlushChain = agentLogFlushChain.then(async function () {
          try {
            const file = await agentLogFile()
            const text = await readTextAt(file)
            const lines = (text || '').split('\n').filter(function (x) { return x.trim() !== '' })
            if (lines.length && lines[lines.length - 1] === key) return
            await appendTextAt(file, key + '\n')
          } catch (e) {}
        })
        if (kind === 'end' && model) {
          for (let i = agentLog.length - 2; i >= 0; i--) {
            const s = agentLog[i]
            if (s && s.kind === 'start' && !s.model && (s.id === entry.id || s.runId === entry.runId)) { s.model = model.model; s.modelProvider = model.provider; rewriteAgentLog(); break }
          }
        }
      } catch (e) {}
    }
    ctx.on('subagent/start', function (info) { pushAgentLog('start', info) })
    ctx.on('subagent/end', function (info) { pushAgentLog('end', info); enrichAgentLog() })
    ctx.interval(function () { enrichAgentLog() }, 120000)

    // ================= Token 快照（存活会话 + 已结束子代理） =================
    const tokenHistory = []
    const tokenCache = new Map()
    function sampleTokens() {
      try {
        const agents = ctx.get('agents'); const tm = ctx.get('tokenMeter')
        if (agents === undefined || tm === undefined) return
        const roots = agents.roots(); if (roots.length === 0) return
        const m = tm.measure(roots[0].session)
        tokenHistory.push({ at: now(), total: m.totalTokens })
        if (tokenHistory.length > 120) tokenHistory.splice(0, tokenHistory.length - 120)
      } catch (e) {}
    }
    ctx.interval(sampleTokens, 5000)
    sampleTokens()
    let persistedRowsCache = { at: 0, rows: [] }
    async function persistedSubagentRows(limit) {
      const nowMs = Date.now()
      if (nowMs - persistedRowsCache.at < 10000) return persistedRowsCache.rows
      const out = []
      const sq = ctx.get('sessionQuery')
      if (sq !== undefined) {
        try {
          const list = await sq.listSessions()
          const subs = []
          for (const r of list) {
            const h = r.header
            if (!h || typeof h.id !== 'string') continue
            if (h.origin !== 'subagent' && !h.parentSession) continue
            subs.push(r)
          }
          subs.sort(function (a, b) { return (b.header.createdAt || 0) - (a.header.createdAt || 0) })
          const pc = ctx.get('sessionProjectionCache')
          const sessions = ctx.get('sessions')
          const tm = ctx.get('tokenMeter')
          for (const r of subs.slice(0, limit)) {
            const sid = r.header.id
            try {
              const live = sessions ? sessions.get(sid) : undefined
              let input = 0, output = 0, hasUsage = false
              if (live && tm) {
                try {
                  const m = tm.measure(live)
                  if (m.baseline && m.baseline.kind === 'usage') { input = m.baseline.usage.inputTokens; output = m.baseline.usage.outputTokens; hasUsage = true }
                } catch (e) {}
              }
              if (!hasUsage && pc) {
                try {
                  const snap = pc.cachedSnapshot(r.header)
                  const tu = snap && snap.values && snap.values.tokenUsage
                  if (tu && (tu.uncachedInputTokens || tu.outputTokens || tu.cacheReadTokens || tu.cacheWriteTokens)) {
                    input = tu.uncachedInputTokens + tu.cacheReadTokens + tu.cacheWriteTokens
                    output = tu.outputTokens
                    hasUsage = true
                  }
                } catch (e) {}
              }
              const mod = await resolvePersistedModel(sid)
              out.push({ id: sid, isRoot: false, persisted: !live, totalTokens: input + output, surfaceTokens: 0, surfaceDeltaTokens: 0, model: mod ? mod.model : '', modelProvider: mod ? mod.provider : '', role: mod ? mod.role : '', baseline: hasUsage ? { kind: 'usage', inputTokens: input, outputTokens: output, tokens: input + output } : { kind: 'none', tokens: 0 } })
            } catch (e) { out.push({ id: sid, isRoot: false, persisted: true, error: '读取失败' }) }
          }
        } catch (e) {}
      }
      persistedRowsCache = { at: nowMs, rows: out }
      return out
    }
    async function tokensSnapshot() {
      const agents = ctx.get('agents'); const tm = ctx.get('tokenMeter'); const sq = ctx.get('sessionQuery')
      const nowMs = Date.now(); const rows = []
      if (agents !== undefined && tm !== undefined) {
        const list = agents.list(); const roots = agents.roots()
        for (const a of list) {
          let sid
          try { sid = String(a.session && a.session.id) } catch (e) { continue }
          try {
            const cached = tokenCache.get(sid)
            if (cached !== undefined && nowMs - cached.at < 2000) { rows.push(cached.data); continue }
            const m = tm.measure(a.session); const isUsage = m.baseline && m.baseline.kind === 'usage'
            const mod = modelOfSession(a.session)
            const data = { id: sid, isRoot: roots.indexOf(a) >= 0, totalTokens: m.totalTokens, surfaceTokens: m.surfaceTokens, surfaceDeltaTokens: m.surfaceDeltaTokens, model: mod ? mod.model : '', modelProvider: mod ? mod.provider : '', baseline: isUsage ? { kind: 'usage', inputTokens: m.baseline.usage.inputTokens, outputTokens: m.baseline.usage.outputTokens, tokens: m.baseline.tokens } : { kind: m.baseline ? m.baseline.kind : 'none', tokens: m.baseline ? m.baseline.tokens : 0 }, logRevision: m.logRevision }
            tokenCache.set(sid, { at: nowMs, data }); rows.push(data)
          } catch (e) { rows.push({ id: sid, error: String((e && e.message) || e) }) }
        }
      }
      const liveIds = new Set(rows.map(function (r) { return r.id }))
      for (const row of await persistedSubagentRows(30)) { if (!liveIds.has(row.id)) rows.push(row) }
      if (sq !== undefined) { for (const r of rows) { if (r.error || !r.id) continue; try { const t = await sq.readTitle(r.id); if (t && typeof t.title === 'string' && t.title) r.title = t.title } catch (e) {} } }
      return { at: now(), rows, history: tokenHistory.slice(-60) }
    }

    // ================= Web API（面板数据源） =================
    // v2：/company-api 路由统一由 company-r2 注册（含 canvas/events/flow/contract 等新路由）。
    // company-panel 不再注册，避免「先到先得」抢注旧路由集导致新路由 404。
    // v3：/company 画布页 + /company/static 静态文件改由本宿主平面插件注册——
    // 开机即注册、永久生效；预置 company-r2 会话挂载/卸载不再影响画布页面可用性
    // （company-r2 侧同名注册会因 duplicate 抛错并被其 try/catch 吞掉，无副作用）。
    // 兼容注：DSH ≥ 0.1.0-rc.6 里未在 inject 声明的服务 ctx.get() 拿不到，
    // webServer 必须进 inject，否则下面整段路由注册被静默跳过（胶囊照常出现，
    // 但 /company 与 /company-api 全部 404 回落到宿主 SPA）。
    const webServer = ctx.get('webServer')
    if (webServer !== undefined) {
      // 宿主平面挂载是 node_modules/software-company-panel 符号链接；DSH ≥ rc.6
      // 的加载器不穿透符号链接，import.meta.url 停在链接路径上，'../company-r2/web/'
      // 会解析到不存在的 node_modules/company-r2/web/。先 realpath 回 preset 真实目录。
      let webDir = new URL('../company-r2/web/', import.meta.url).pathname
      try {
        webDir = dirname(realpathSync(fileURLToPath(import.meta.url))) + '/../company-r2/web/'
      } catch (e) { /* realpath 失败退回链接相对路径 */ }
      async function readWebFile(name) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return undefined
        return await readTextAt(webDir + name)
      }
      try {
        ctx.effect(() => webServer.register({
          kind: 'exact',
          path: '/company',
          handler: async function (req, res) {
            const html = await readWebFile('canvas.html')
            if (html === undefined) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('canvas.html missing'); return }
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
            res.end(html)
          },
        }))
      } catch (e) { /* 已被注册则复用 */ }
      try {
        ctx.effect(() => webServer.register({
          kind: 'prefix',
          path: '/company/static',
          handler: async function (req, res) {
            const p = new URL(req.url || '/', 'http://x').pathname.replace('/company/static/', '')
            const text = await readWebFile(p)
            if (text === undefined) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return }
            const type = p.endsWith('.js') ? 'text/javascript; charset=utf-8' : (p.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/plain; charset=utf-8')
            res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
            res.end(text)
          },
        }))
      } catch (e) { /* 已被注册则复用 */ }
    }
  },
}
