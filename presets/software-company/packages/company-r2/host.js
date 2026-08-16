import nodeFs from 'node:fs'
import { FLOW_TEMPLATES, STAGES_LEGACY, validateFlow, readyNodes, adjustFlow } from './lib/flow.js'
import { createEventsFile, appendEvent, readSince } from './lib/events.js'
import { buildContract, validateContract, signContract, renderContractMarkdown, assertionBadges } from './lib/contract.js'
import { attributeUsage, aggregateByDepartment } from './lib/usage.js'
import { DEPT_ID_RE, validateHire, renderDeptPresetYml, mergeRole, undoRole } from './lib/hire.js'

export default {
  name: 'software-company-harness',
  inject: ['fs', 'tools', 'timer'],
  apply(ctx) {
    const fsService = ctx.fs
    const sandboxPolicy = ctx.get('sandboxPolicy')

    // ================= 角色库（单一来源：preset 根 roles/roles.json；reasoning 已按五刀④分档） =================
    const ROLES_FILE = new URL('../../roles/roles.json', import.meta.url).pathname
    const ROLES_FALLBACK = {
      'coordinator': { id: 'coordinator', title: 'Coordinator 项目总控', model: 'deepseek-v4-pro', reasoning: 'max', duties: '分类、组队、派工、状态推进、冲突裁决、暂停与升级', forbidden: '不直接编码；不替 QA 放行' },
      'generator': { id: 'generator', title: '主程序员 Generator', model: 'deepseek-v4-pro', reasoning: 'high', duties: '实现策略、核心代码、自检、协调部门程序员', forbidden: '不修改验收结论；不批准自己' },
    }
    let ROLES = ROLES_FALLBACK
    function loadRoles() {
      try {
        const data = JSON.parse(nodeFs.readFileSync(ROLES_FILE, 'utf8'))
        if (Array.isArray(data.roles)) ROLES = Object.fromEntries(data.roles.map((r) => [r.id, r]))
      } catch (e) { /* 保留兜底 */ }
    }
    loadRoles()
    const IMPLEMENTATION_ROLES = ['generator', 'department-generator', 'integrator', 'repair-generator']
    const CONCURRENCY_CAP = { small: 1, medium: 3, complex: 2, 'high-risk': 2 }

    const EDGES = {
      INTAKE: ['CLASSIFIED'],
      CLASSIFIED: ['DISCOVERY'],
      DISCOVERY: ['PRODUCT_PLANNED'],
      PRODUCT_PLANNED: ['WAITING_INITIAL_APPROVAL', 'SPRINT_DRAFTING'],
      WAITING_INITIAL_APPROVAL: ['SPRINT_DRAFTING', 'PRODUCT_PLANNED'],
      SPRINT_DRAFTING: ['CONTRACT_REVIEW', 'CONTRACT_SIGNED'],
      CONTRACT_REVIEW: ['CONTRACT_SIGNED', 'SPRINT_DRAFTING'],
      CONTRACT_SIGNED: ['IMPLEMENTING'],
      IMPLEMENTING: ['SELF_CHECK'],
      SELF_CHECK: ['INTEGRATING', 'QA_RUNNING'],
      INTEGRATING: ['QA_RUNNING'],
      QA_RUNNING: ['SPRINT_PASSED', 'REPAIRING', 'REPLANNING'],
      SPRINT_PASSED: ['SPRINT_DRAFTING', 'FINAL_E2E', 'RELEASED'],
      REPAIRING: ['QA_RUNNING', 'FINAL_E2E'],
      REPLANNING: ['SPRINT_DRAFTING'],
      FINAL_E2E: ['RELEASED', 'REPAIRING', 'REPLANNING'],
      RELEASED: [],
      PAUSED: [],
      TERMINATED: [],
    }
    const TERMINAL_STATES = ['RELEASED', 'TERMINATED']

    const DOC_OWNERS = {
      TASK_BRIEF: ['coordinator'],
      PRODUCT_SPEC: ['planner'],
      ARCHITECTURE: ['architect'],
      SPRINT_PLAN: ['planner'],
      WORK_OWNERSHIP: ['coordinator'],
      DECISIONS: ['coordinator'],
      IMPLEMENTATION: IMPLEMENTATION_ROLES,
      QA_EVIDENCE: ['qa-runner', 'coordinator'],
      QA_REPORT: ['sprint-evaluator'],
      HANDOFF: ['recorder'],
      COST_LEDGER: ['recorder'],
      FINAL_ACCEPTANCE: ['final-evaluator'],
    }
    const SPRINT_DOCS = { IMPLEMENTATION: 1, QA_EVIDENCE: 1, QA_REPORT: 1, HANDOFF: 1 }
    const APPEND_DEFAULT = { DECISIONS: 1, COST_LEDGER: 1, IMPLEMENTATION: 1, QA_EVIDENCE: 1, QA_REPORT: 1 }
    const SHARED_SURFACES = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'cargo.lock', 'poetry.lock', 'go.sum', 'gemfile.lock', 'requirements', 'composer.lock', 'migration', 'alembic', 'prisma', '.github', 'dockerfile', 'docker-compose', '/ci/', 'deploy', 'tokens', 'theme', 'design-system', 'generated']

    const RISK_WORDS = ['支付', '付款', '退款', '提现', '账单', '扣款', '交易', '权限', '鉴权', '认证', '密码', '密钥', '隐私', '个人信息', '删除', '销毁', '清空', 'drop table', '迁移', '搬迁', '生产环境', '上线', '发布', '外发', '群发', '短信', '邮件', '风控', '合规', '审计', 'oauth']
    const EXTERNAL_WORDS = ['api', '接口', '第三方', '外部', 'webhook', '回调', '开放平台', '对接', '集成', 'sdk', '网关', '短信', '邮件服务', 'oauth']
    const AMBIG_WORDS = ['优化', '完善', '提升', '改进', '改善', '体验', '好用', '更好', '大概', '可能', '一些', '之类', '等等', '酌情', '适当']
    function countHits(words, text) { return words.filter(function (w) { return text.indexOf(w) >= 0 }).length }
    function classify(requirement) {
      const r = String(requirement || '').toLowerCase()
      const risk = countHits(RISK_WORDS, r)
      const ext = countHits(EXTERNAL_WORDS, r)
      const ambig = countHits(AMBIG_WORDS, r)
      const multi = r.length > 60 || /前后端|全栈|多个模块|多模块|数据库|跨模块/.test(r)
      const dataImpact = /数据|表结构|字段|迁移|持久化|存储|数据库|schema/.test(r)
      let type
      if (risk > 0) type = 'high-risk'
      else if (multi && ext > 0) type = 'complex'
      else if (multi || ambig > 0 || ext > 0 || dataImpact) type = 'medium'
      else type = 'small'
      return {
        type,
        factors: {
          ambiguity: ambig > 0 ? 'high' : 'low',
          moduleSpan: multi ? 'multi' : 'single',
          dataImpact,
          externalIntegration: ext > 0,
          failureRisk: risk > 0 ? 'high' : (ambig > 0 ? 'medium' : 'low'),
        },
      }
    }
    function teamFor(type) {
      if (type === 'small') return ['coordinator', 'generator']
      if (type === 'medium') return ['coordinator', 'planner', 'explorer', 'generator', 'sprint-evaluator', 'qa-runner', 'recorder']
      if (type === 'complex') return ['coordinator', 'planner', 'architect', 'explorer', 'generator', 'department-generator', 'integrator', 'sprint-evaluator', 'qa-runner', 'recorder', 'final-evaluator']
      return ['coordinator', 'planner', 'architect', 'explorer', 'generator', 'department-generator', 'integrator', 'sprint-evaluator', 'qa-runner', 'recorder', 'final-evaluator', 'security-reviewer']
    }

    function pad2(n) { return n < 10 ? '0' + n : String(n) }
    function fnv1a(str) {
      let h = 0x811c9dc5
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
      return ('00000000' + h.toString(16)).slice(-8)
    }
    function now() { return new Date().toISOString() }
    function ymd() { const d = new Date(); return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate()) }

    async function resolveAbs(path) {
      const t = await fsService.resolve(path)
      return fsService.processPath(t)
    }
    function callSession() {
      try {
        const agents = ctx.get('agents')
        const a = agents ? agents.currentInitiator() : undefined
        if (a && a.session) return a.session
      } catch (e) {}
      return undefined
    }
    function writePolicyFor(abs) {
      if (!sandboxPolicy) return undefined
      try {
        const session = callSession()
        if (session !== undefined) return sandboxPolicy.resolve({ session })
      } catch (e) {}
      try {
        const base = sandboxPolicy.resolve()
        const s = String(abs || '')
        const idx = s.indexOf('/.company-harness/')
        if (idx > 0 && base && base.mode === 'workspace-write') {
          return { mode: 'workspace-write', workspaceRoot: s.slice(0, idx) }
        }
        return base
      } catch (e) {}
      return undefined
    }
    async function defaultProjectDir() {
      try {
        const session = callSession()
        if (session && session.header && typeof session.header.cwd === 'string' && session.header.cwd) return session.header.cwd
      } catch (e) {}
      try {
        const ws = ctx.get('workspaceRegistry')
        const list = ws ? ws.list() : undefined
        if (list && list.length && list[0] && typeof list[0].path === 'string' && list[0].path) return list[0].path
      } catch (e) {}
      if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot) return sandboxPolicy.workspaceRoot
      return await resolveAbs('.')
    }
    async function readTextAt(abs) {
      const t = await fsService.resolve(abs)
      const info = await fsService.stat(t)
      if (!info || info.type !== 'file') return undefined
      return await fsService.readText(t)
    }
    async function writeTextAt(abs, content) {
      await fsService.writeText(await fsService.resolve(abs), content, undefined, undefined, writePolicyFor(abs))
    }
    async function appendTextAt(abs, content) {
      const old = await readTextAt(abs)
      await writeTextAt(abs, (old === undefined ? '' : old + '\n') + content)
    }
    async function readJsonAt(abs) {
      const s = await readTextAt(abs)
      if (s === undefined) return undefined
      try { return JSON.parse(s) } catch (e) { return undefined }
    }
    async function writeJsonAt(abs, value) {
      await writeTextAt(abs, JSON.stringify(value, null, 2))
    }

    function taskDirOf(state) { return state.projectDir + '/.company-harness/tasks/' + state.taskId }
    function sprintDirOf(state, sprintId) { return taskDirOf(state) + '/sprints/' + sprintId }
    function eventsFileFor(state) {
      const base = state && state.projectDir ? state.projectDir : process.cwd()
      return createEventsFile(base + '/.company-harness/events')
    }
    function contractsDirOf(state) { return taskDirOf(state) + '/contracts' }

    async function registryFilePath() { return (await defaultProjectDir()) + '/.company-harness/registry.json' }
    async function loadRegistry() {
      const j = await readJsonAt(await registryFilePath())
      return j && Array.isArray(j.projects) ? j : { version: 1, projects: [] }
    }
    async function registerProject(dir) {
      const reg = await loadRegistry()
      if (reg.projects.indexOf(dir) < 0) { reg.projects.push(dir); await writeJsonAt(await registryFilePath(), reg) }
    }
    async function projectList() {
      const seen = [await defaultProjectDir()]
      const reg = await loadRegistry()
      for (const p of reg.projects || []) { if (seen.indexOf(p) < 0) seen.push(p) }
      return seen
    }
    async function loadTask(taskId) {
      for (const p of await projectList()) {
        const s = await readJsonAt(p + '/.company-harness/tasks/' + taskId + '/RUN_STATE.json')
        if (s && s.taskId === taskId) return s
      }
      return undefined
    }
    async function listAllTasks(projectFilter) {
      const projects = projectFilter ? [await resolveAbs(projectFilter)] : await projectList()
      const out = []
      for (const p of projects) {
        const t = await fsService.resolve(p + '/.company-harness/tasks')
        const info = await fsService.stat(t)
        if (!info || info.type !== 'directory') continue
        const entries = await fsService.listDir(t)
        for (const e of entries) {
          if (e.type !== 'directory') continue
          const s = await readJsonAt(p + '/.company-harness/tasks/' + e.name + '/RUN_STATE.json')
          if (!s || s.taskId !== e.name) continue
          out.push({
            taskId: s.taskId, project: p, mode: s.mode,
            type: s.classification ? s.classification.type : 'unknown',
            status: s.status, currentSprint: s.currentSprint || null,
            sprintsDone: (s.sprints || []).filter(function (x) { return x.status === 'PASSED' }).length,
            sprintTotal: (s.sprints || []).length,
            repairs: (s.sprints || []).reduce(function (a, x) { return a + (x.repairAttempts || 0) }, 0) + (s.finalRepairs || 0),
            replans: s.replans || 0,
            updatedAt: s.updatedAt || null,
          })
        }
      }
      out.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) })
      return out
    }
    async function allocTaskId(base) {
      const tasksDir = base + '/.company-harness/tasks'
      const prefix = 'TASK-' + ymd() + '-'
      let max = 0
      const t = await fsService.resolve(tasksDir)
      const info = await fsService.stat(t)
      if (info && info.type === 'directory') {
        const entries = await fsService.listDir(t)
        for (const e of entries) {
          if (e.name.indexOf(prefix) !== 0) continue
          const n = parseInt(e.name.slice(prefix.length), 10)
          if (!isNaN(n) && n > max) max = n
        }
      }
      return prefix + String(max + 1).padStart(3, '0')
    }

    function assertEdge(state, to) {
      const from = state.status
      if (to === 'TERMINATED') {
        if (TERMINAL_STATES.indexOf(from) >= 0) throw new Error('已处于终态 ' + from + '，不能终止')
        return
      }
      if (to === 'PAUSED') {
        if (TERMINAL_STATES.indexOf(from) >= 0 || from === 'PAUSED') throw new Error('当前状态 ' + from + ' 不能暂停')
        return
      }
      if (from === 'PAUSED') {
        if (to === state.pausedFrom) return
        throw new Error('恢复只能回到暂停前状态 ' + state.pausedFrom + '，收到 ' + to)
      }
      const allowed = EDGES[from] || []
      if (allowed.indexOf(to) < 0) throw new Error('非法状态转换 ' + from + ' → ' + to + '；允许: ' + allowed.join(', '))
    }
    async function saveState(state) {
      state.updatedAt = now()
      await writeJsonAt(taskDirOf(state) + '/RUN_STATE.json', state)
    }
    async function transition(state, to, reason, refs) {
      if (!Array.isArray(refs) || refs.length === 0) throw new Error('状态转换必须引用文件、commit 或测试证据 refs（至少 1 项）')
      assertEdge(state, to)
      const from = state.status
      state.history.push({ at: now(), from, to, reason, refs })
      state.status = to
      if (to === 'PAUSED') state.pausedFrom = from
      if (from === 'REPLANNING' && to === 'SPRINT_DRAFTING') state.replans = (state.replans || 0) + 1
      await saveState(state)
      try {
        appendEvent(eventsFileFor(state), { type: 'status', taskId: state.taskId, from, to, reason })
      } catch (e) {}
      if (to === 'SPRINT_PASSED') {
        try {
          appendEvent(eventsFileFor(state), { type: 'review.pass', taskId: state.taskId, badges: assertionBadges(await deterministicBadgesFrom(state)) })
        } catch (e) {}
      }
      return state
    }

    function parseClaims(md) {
      if (!md) return []
      const m = md.match(/```json\s*([\s\S]*?)```/)
      if (!m) return []
      try { const v = JSON.parse(m[1]); return Array.isArray(v) ? v : [] } catch (e) { return [] }
    }
    function renderOwnership(state, claims) {
      return '# Work Ownership — ' + state.taskId + '\n\n> 唯一负责人：Coordinator。并行写入的前提：Sprint Contract 已签署、文件集合互不交叉、每个部门独立 worktree/分支、接口与数据结构已冻结、已指定唯一 Integrator。\n> 共享表面（依赖锁文件、公共类型、数据库迁移、CI、部署配置、共享样式令牌、跨模块生成文件）只能由 Integrator 串行修改。\n> 发现冲突：停止后进入者，保留现场不自动回滚，Coordinator 标记 OWNERSHIP_CONFLICT。\n\n## Claims (JSON)\n```json\n' + JSON.stringify(claims, null, 2) + '\n```\n'
    }
    function normalizeClaimPath(p) {
      let s = String(p || '').replace(/\\/g, '/')
      while (s.indexOf('./') === 0) s = s.slice(2)
      while (s.charAt(0) === '/') s = s.slice(1)
      while (s.length > 0 && s.charAt(s.length - 1) === '/') s = s.slice(0, -1)
      return s.toLowerCase()
    }
    function pathsOverlap(a, b) {
      if (a === b) return true
      if (a.length === 0 || b.length === 0) return true
      return a.indexOf(b + '/') === 0 || b.indexOf(a + '/') === 0
    }
    function isSharedSurface(path) {
      const p = normalizeClaimPath(path)
      for (const s of SHARED_SURFACES) { if (p.indexOf(s) >= 0) return true }
      return false
    }

    function nextStepsFor(state) {
      const s = state.status
      const small = state.classification && state.classification.type === 'small' && state.mode !== 'forced-full'
      const map = {
        WAITING_INITIAL_APPROVAL: ['用户审阅 PRODUCT_SPEC.md 与 SPRINT_PLAN.md', '批准：company_approve（或 UI 面板【批准】按钮）', '有修改意见：company_approve(feedback=...) 退回规划，Planner 修订后再批'],
        SPRINT_DRAFTING: small
          ? ['小型任务：Coordinator 冻结 SPRINT_CONTRACT（company_freeze_contract，deterministicCoverage 必须为 true，否则必须先 company_reclassify 提升为中型）']
          : ['中型+：先 company_set_state → CONTRACT_REVIEW', 'Sprint Evaluator 评审合同后用 company_freeze_contract(frozenBy=sprint-evaluator) 签署'],
        CONTRACT_REVIEW: ['Sprint Evaluator 评审 SPRINT_CONTRACT', '通过：company_freeze_contract(frozenBy=sprint-evaluator)', '不通过：company_set_state → SPRINT_DRAFTING 修订'],
        CONTRACT_SIGNED: ['company_set_state → IMPLEMENTING（附自检说明文件 refs）', '各部门先 company_claim 声明文件所有权，再并行编码（worktree/分支互不交叉）'],
        IMPLEMENTING: ['Generator 写 IMPLEMENTATION.md 并自检', 'company_set_state → SELF_CHECK', '多工作区 → INTEGRATING（唯一 Integrator 合并共享表面）'],
        SELF_CHECK: ['单工作区：company_set_state → QA_RUNNING', '多工作区：company_set_state → INTEGRATING'],
        INTEGRATING: ['Integrator 合并并全量回归后 company_set_state → QA_RUNNING'],
        QA_RUNNING: ['QA 执行员采集证据 QA_EVIDENCE.md', 'Sprint Evaluator 写 QA_REPORT.md 后 company_verdict（PASS/FAIL）', small ? '小型确定性门禁：Coordinator 依据确定性测试结果 company_verdict' : ''],
        REPAIRING: ['company_start_repair 获取冻结修复上下文', '启动全新 Repair Generator（deepseek-v4-pro/high）定点修复', '修复后 company_set_state → QA_RUNNING（Sprint）或 → FINAL_E2E（最终），附 repair commit refs'],
        REPLANNING: ['Planner＋架构负责人重新规划（company_write_doc 修订 PRODUCT_SPEC/SPRINT_PLAN）', 'Coordinator(Max) 确认仍在已批准范围后 company_set_state → SPRINT_DRAFTING'],
        SPRINT_PASSED: ['下一轮 Sprint：company_set_state → SPRINT_DRAFTING', '全部完成：medium 全部 Sprint PASS 且当前 Sprint deterministicCoverage=true 可直接 company_set_state → RELEASED；complex/high-risk/forced-full 必须 company_set_state → FINAL_E2E', small ? '小型且确定性门禁覆盖全部标准：company_set_state → RELEASED' : ''],
        FINAL_E2E: ['QA 执行员提供真实 UI/API/DB/测试证据', '最终验收负责人写 FINAL_ACCEPTANCE.md 后 company_verdict(scope=final)'],
        PAUSED: ['company_control(action=resume) 恢复（回到暂停前状态）'],
      }
      return (map[s] || []).filter(function (x) { return x !== '' })
    }

    async function inventoryDir(abs) {
      const out = []
      const t = await fsService.resolve(abs)
      const info = await fsService.stat(t)
      if (!info || info.type !== 'directory') return out
      const entries = await fsService.listDir(t)
      for (const e of entries) {
        if (e.type === 'directory') {
          const sub = await inventoryDir(abs + '/' + e.name)
          for (const x of sub) out.push(x)
        } else {
          out.push(abs + '/' + e.name)
        }
      }
      return out
    }
    function verdictStats(state) {
      let total = 0, passed = 0
      for (const s of state.sprints || []) {
        for (const v of s.verdicts || []) { total++; if (v.verdict === 'PASS') passed++ }
      }
      return { total, passed }
    }
    function findIntegrationCommit(state) {
      for (let i = (state.history || []).length - 1; i >= 0; i--) {
        const h = state.history[i]
        if (/集成|合并|merge|integrating/i.test(h.reason || '')) {
          for (const r of h.refs || []) {
            const m = String(r).match(/[0-9a-f]{7,40}/i)
            if (m) return m[0]
          }
        }
      }
      return '未记录（不可获得）'
    }
    async function buildReceipt(state) {
      const stats = verdictStats(state)
      const repairs = (state.sprints || []).reduce(function (a, x) { return a + (x.repairAttempts || 0) }, 0) + (state.finalRepairs || 0)
      const roles = (state.rolesLaunched || []).map(function (r) { return r.role + '(' + r.model + '/' + r.reasoning + ')' })
      const approval = (state.approvals || [])[0]
      const done = (state.sprints || []).filter(function (x) { return x.status === 'PASSED' }).length
      const lines = []
      lines.push('任务：' + state.taskId)
      lines.push('最终状态：' + state.status)
      lines.push('批准的产品规格：版本 1 / 校验值 ' + (approval ? approval.specChecksum + ' (SPEC) · ' + approval.planChecksum + ' (PLAN)' : '未批准'))
      lines.push('完成 Sprint：' + done + ' / ' + (state.sprints || []).length)
      lines.push('集成 commit：' + findIntegrationCommit(state))
      lines.push('验收合同：通过 ' + stats.passed + ' / ' + stats.total)
      lines.push('自动修复：' + repairs + ' 次')
      lines.push('重新规划：' + (state.replans || 0) + ' 次')
      lines.push('实际启动角色：' + (roles.length ? roles.join('、') : '无'))
      const evidence = []
      for (const s of state.sprints || []) {
        if (s.verdicts && s.verdicts.length) evidence.push(s.id + ': ' + s.verdicts.map(function (v) { return v.verdict + '@' + (v.at || '') }).join(','))
      }
      lines.push('测试证据：' + (evidence.length ? evidence.join('；') : '无'))
      lines.push('剩余风险：见 FINAL_ACCEPTANCE.md / QA_REPORT.md（未脱敏数据不入库）')
      lines.push('成本记录：COST_LEDGER.md（真实可获得用量；不可获得处记「不可获得」，不估算）')
      return lines.join('\n')
    }

    async function writeDoc(args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      const doc = args.doc
      const authorRole = args.authorRole
      const content = String(args.content || '')
      const owners = DOC_OWNERS[doc]
      if (!owners) return { ok: false, error: '未知文档类型 ' + doc + '；可选: ' + Object.keys(DOC_OWNERS).join(', ') }
      if (owners.indexOf(authorRole) < 0) {
        return { ok: false, code: 'OWNERSHIP_DENIED', error: doc + '.md 的负责人是 ' + owners.join('/') + '，不是 ' + authorRole }
      }
      const s = state.status
      if (doc === 'PRODUCT_SPEC' || doc === 'ARCHITECTURE' || doc === 'SPRINT_PLAN') {
        if (s === 'INTAKE' || s === 'CLASSIFIED' || s === 'DISCOVERY') return { ok: false, error: '发现阶段未完成（当前 ' + s + '），不能写规划文档' }
      }
      if (doc === 'QA_EVIDENCE' && authorRole === 'coordinator') {
        const smallTask = state.classification && state.classification.type === 'small' && state.mode !== 'forced-full'
        if (!smallTask) return { ok: false, error: 'QA_EVIDENCE 只能由 QA 执行员采集；小型确定性门禁才允许 Coordinator 记录确定性测试结果' }
      }
      const sprintId = args.sprintId || null
      let sprint = null
      let abs
      if (SPRINT_DOCS[doc]) {
        if (!sprintId) return { ok: false, error: 'Sprint 文档 ' + doc + ' 需要 sprintId' }
        sprint = (state.sprints || []).find(function (x) { return x.id === sprintId })
        if (!sprint) return { ok: false, error: 'Sprint ' + sprintId + ' 尚未登记（先 company_freeze_contract 冻结合同）' }
        abs = sprintDirOf(state, sprintId) + '/' + doc + '.md'
        if (doc === 'IMPLEMENTATION') {
          if (['CONTRACT_SIGNED', 'IMPLEMENTING', 'SELF_CHECK', 'INTEGRATING', 'QA_RUNNING', 'REPAIRING', 'REPLANNING', 'SPRINT_PASSED', 'FINAL_E2E'].indexOf(s) < 0) return { ok: false, error: '状态 ' + s + ' 不允许写实现记录' }
          if (sprint.implementers.indexOf(authorRole) < 0) sprint.implementers.push(authorRole)
        } else if (doc === 'QA_EVIDENCE') {
          if (['QA_RUNNING', 'REPAIRING', 'FINAL_E2E'].indexOf(s) < 0) return { ok: false, error: '状态 ' + s + ' 不允许采集 QA 证据' }
        } else if (doc === 'QA_REPORT') {
          if (s !== 'QA_RUNNING') return { ok: false, error: 'QA_REPORT 只能在 QA_RUNNING 状态由 Sprint Evaluator 撰写' }
        }
      } else {
        abs = taskDirOf(state) + '/' + doc + '.md'
        if (doc === 'FINAL_ACCEPTANCE') {
          if (s !== 'FINAL_E2E' && s !== 'RELEASED') return { ok: false, error: '最终验收文档只能在 FINAL_E2E/RELEASED 状态写入' }
        }
      }
      let append = Boolean(APPEND_DEFAULT[doc])
      if (args.append === true) append = true
      if (args.append === false) append = false
      if (append) await appendTextAt(abs, content)
      else await writeTextAt(abs, content)
      if ((doc === 'PRODUCT_SPEC' || doc === 'SPRINT_PLAN') && (state.approvals || []).length > 0) {
        state.history.push({ at: now(), from: s, to: s, reason: '注意：批准后修改 ' + doc + '.md（批准时记录的校验值已过期，需重新批准或记录变更）', refs: [abs] })
      }
      await saveState(state)
      return { ok: true, file: abs, taskId: state.taskId, doc, append }
    }

    function sanitize(v) {
      if (v === undefined || typeof v === 'function') return null
      if (Array.isArray(v)) {
        const a = []
        for (const x of v) a.push(sanitize(x))
        return a
      }
      if (v !== null && typeof v === 'object') {
        const o = {}
        for (const k of Object.keys(v)) {
          const x = sanitize(v[k])
          if (x !== undefined) o[k] = x
        }
        return o
      }
      return v
    }

    // ================= 子代理日志（持久累加）与 Token 采样 =================
    const agentLog = []
    let agentLogFlushChain = Promise.resolve()
    const tokenHistory = []
    const tokenCache = new Map()
    async function agentLogFile() { return (await defaultProjectDir()) + '/.company-harness/agents-log.jsonl' }
    async function allWorkspaceDirs() {
      const dirs = []
      try {
        const ws = ctx.get('workspaceRegistry')
        const list = ws ? ws.list() : undefined
        if (list) { for (const w of list) { if (w && typeof w.path === 'string' && dirs.indexOf(w.path) < 0) dirs.push(w.path) } }
      } catch (e) {}
      try { const d = await defaultProjectDir(); if (dirs.indexOf(d) < 0) dirs.push(d) } catch (e) {}
      return dirs
    }
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
              seen.add(key)
              gathered.push(o)
            } catch (e) {}
          }
        } catch (e) {}
      }
      gathered.sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')) })
      for (const o of gathered) agentLog.push(o)
    }
    loadAgentLog()
    // 模型来源：会话日志中的 request/header（config.provider/model）或 request/context（provider/model）
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
    // 已结束子代理的模型来源：存活会话取 requestHeader，否则从持久日志扫 request/context（provider+model 真实路由记录）
    const persistedModelCache = new Map()
    async function resolvePersistedModel(sid) {
      try {
        const cached = persistedModelCache.get(sid)
        if (cached !== undefined && Date.now() - cached.at < 60000) { return cached.model ? { provider: cached.provider, model: cached.model } : undefined }
        let found
        try {
          const sessions = ctx.get('sessions')
          const live = sessions ? sessions.get(sid) : undefined
          if (live) found = modelOfSession(live)
        } catch (e) {}
        if (found === undefined) {
          const sq = ctx.get('sessionQuery')
          if (sq !== undefined) {
            const snap = await sq.readSession(sid)
            if (snap && Array.isArray(snap.events)) {
              for (let i = snap.events.length - 1; i >= 0; i--) {
                const e = snap.events[i]
                if (e && e.type === 'request/context' && e.data && e.data.model) { found = { provider: String(e.data.provider || ''), model: String(e.data.model) }; break }
              }
            }
          }
        }
        persistedModelCache.set(sid, { at: Date.now(), model: found ? found.model : '', provider: found ? found.provider : '' })
        return found
      } catch (e) { return undefined }
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
    function rewriteAgentLog() {
      agentLogFlushChain = agentLogFlushChain.then(async function () {
        try {
          await writeTextAt(await agentLogFile(), agentLog.slice(-2000).map(function (x) { return JSON.stringify(x) }).join('\n') + '\n')
        } catch (e) {}
      })
    }
    function pushAgentLog(kind, info) {
      try {
        const model = modelOfInfo(info)
        const entry = {
          at: now(), kind,
          runId: String((info && info.runId) || ''),
          provider: String((info && info.provider) || ''),
          id: String((info && info.id) || ''),
          local: !!(info && info.local),
          model: model ? model.model : '',
          modelProvider: model ? model.provider : '',
          stopReason: kind === 'end' ? String((info && info.stopReason) || '') : null,
        }
        agentLog.push(entry)
        if (agentLog.length > 2500) agentLog.splice(0, agentLog.length - 2500)
        // 串行落盘：记录持久累加，插件重载/服务重启不丢失（H-11 精神）
        agentLogFlushChain = agentLogFlushChain.then(async function () {
          try {
            await appendTextAt(await agentLogFile(), JSON.stringify(entry) + '\n')
            if (agentLog.length > 2500) {
              await writeTextAt(await agentLogFile(), agentLog.slice(-2000).map(function (x) { return JSON.stringify(x) }).join('\n') + '\n')
              agentLog.splice(0, agentLog.length - 2000)
            }
          } catch (e) {}
        })
        // 启动瞬间模型头可能尚未落日志：结束时回填同 id/runId 的启动行，并整文件重写以持久化
        if (kind === 'end' && model) {
          for (let i = agentLog.length - 2; i >= 0; i--) {
            const s = agentLog[i]
            if (s && s.kind === 'start' && !s.model && (s.id === entry.id || s.runId === entry.runId)) {
              s.model = model.model
              s.modelProvider = model.provider
              rewriteAgentLog()
              break
            }
          }
        }
      } catch (e) {}
    }
    ctx.on('subagent/start', function (info) { pushAgentLog('start', info); recordDispatch({ sessionId: info && info.id, at: now() }).catch(function () {}) })
    ctx.on('subagent/end', function (info) { pushAgentLog('end', info); enrichAgentLog() })
    ctx.interval(function () { enrichAgentLog() }, 120000)

    function sampleTokens() {
      try {
        const agents = ctx.get('agents')
        const tm = ctx.get('tokenMeter')
        if (agents === undefined || tm === undefined) return
        const roots = agents.roots()
        if (roots.length === 0) return
        const m = tm.measure(roots[0].session)
        tokenHistory.push({ at: now(), total: m.totalTokens })
        if (tokenHistory.length > 120) tokenHistory.splice(0, tokenHistory.length - 120)
      } catch (e) {}
    }
    ctx.interval(sampleTokens, 5000)
    sampleTokens()

    // 已结束子代理的行来源：持久会话列表（origin=subagent 或有 parentSession）
    // 用量取投影缓存 tokenUsage（uncached+cacheRead+cacheWrite 为输入、output 为输出），模型取会话日志 request/context
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
              out.push({
                id: sid,
                isRoot: false,
                persisted: !live,
                totalTokens: input + output,
                surfaceTokens: 0,
                surfaceDeltaTokens: 0,
                model: mod ? mod.model : '',
                modelProvider: mod ? mod.provider : '',
                baseline: hasUsage ? { kind: 'usage', inputTokens: input, outputTokens: output, tokens: input + output } : { kind: 'none', tokens: 0 },
              })
            } catch (e) { out.push({ id: sid, isRoot: false, persisted: true, error: '读取失败' }) }
          }
        } catch (e) {}
      }
      persistedRowsCache = { at: nowMs, rows: out }
      return out
    }

    async function tokensSnapshot() {
      const agents = ctx.get('agents')
      const tm = ctx.get('tokenMeter')
      const sq = ctx.get('sessionQuery')
      const nowMs = Date.now()
      const rows = []
      if (agents !== undefined && tm !== undefined) {
        const list = agents.list()
        const roots = agents.roots()
        for (const a of list) {
          let sid
          try { sid = String(a.session && a.session.id) } catch (e) { continue }
          try {
            const cached = tokenCache.get(sid)
            if (cached !== undefined && nowMs - cached.at < 2000) { rows.push(cached.data); continue }
            const m = tm.measure(a.session)
            const isUsage = m.baseline && m.baseline.kind === 'usage'
            const mod = modelOfSession(a.session)
            const data = {
              id: sid,
              isRoot: roots.indexOf(a) >= 0,
              totalTokens: m.totalTokens,
              surfaceTokens: m.surfaceTokens,
              surfaceDeltaTokens: m.surfaceDeltaTokens,
              model: mod ? mod.model : '',
              modelProvider: mod ? mod.provider : '',
              baseline: isUsage
                ? { kind: 'usage', inputTokens: m.baseline.usage.inputTokens, outputTokens: m.baseline.usage.outputTokens, tokens: m.baseline.tokens }
                : { kind: m.baseline ? m.baseline.kind : 'none', tokens: m.baseline ? m.baseline.tokens : 0 },
              logRevision: m.logRevision,
            }
            tokenCache.set(sid, { at: nowMs, data })
            rows.push(data)
          } catch (e) { rows.push({ id: sid, error: String((e && e.message) || e) }) }
        }
      }
      // 合并已结束子代理（真实模型 + 投影用量），不重复存活行
      const liveIds = new Set(rows.map(function (r) { return r.id }))
      for (const row of await persistedSubagentRows(30)) { if (!liveIds.has(row.id)) rows.push(row) }
      if (sq !== undefined) {
        for (const r of rows) {
          if (r.error || !r.id) continue
          try {
            const t = await sq.readTitle(r.id)
            if (t && typeof t.title === 'string' && t.title) r.title = t.title
          } catch (e) {}
        }
      }
      return { at: now(), rows, history: tokenHistory.slice(-60) }
    }

    // ================= 公司协议提示段 =================
    const sp = ctx.get('systemPrompt')
    if (sp !== undefined) {
      ctx.effect(() => sp.section({
        name: 'company-protocol',
        order: 300,
        text: '## 软件公司 Harness 协议（本会话必须遵守）\n\n所有软件变更请求必须走公司流程：用 company_start 建立任务（mode: company/auto/forced-full/plan-only；纯解释请求不启动）。\n\n- 需求在编码前变成明确、有限、可验收的范围（PRODUCT_SPEC.md + SPRINT_PLAN.md，Planner 负责）。\n- 每轮一个可控功能块，完成标准在编码前冻结于 SPRINT_CONTRACT.md（小型任务由 Coordinator 冻结且 deterministicCoverage 必须为 true，否则先 company_reclassify 提升为中型；中型+由 Sprint Evaluator 在 CONTRACT_REVIEW 后签署）。冻结后 Generator 不得修改验收标准。\n- 中型/复杂/高风险：编码者与验收者必须相互独立（H-08：Generator 不得签发判定，Evaluator 不得参与编码）；小型任务仅当全部标准可被确定性自动测试完整验证时走 Generator+确定性门禁。\n- 多部门并行写入必须先在 WORK_OWNERSHIP.md 声明互不重叠的所有权（重叠即 OWNERSHIP_CONFLICT）；共享表面（锁文件/迁移/CI/部署/令牌/生成文件）仅 Integrator 串行修改。\n- 任何 FAIL 直接路由全新 Repair Generator（deepseek-v4-pro/high）：两次定点修复 → 一次重新规划 → 再失败暂停并提交证据给用户（H-09/H-10）。\n- 角色库模型约束：coordinator=deepseek-v4-pro/max；planner/architect/generator/department-generator/integrator/sprint-evaluator/final-evaluator/security-reviewer/repair-generator=deepseek-v4-pro/high；explorer/qa-runner=deepseek-v4-flash/medium、mechanical-worker/recorder=deepseek-v4-flash/low（company_record_role 硬校验）。\n- 聊天不是交接依据：状态、交接、证据全部签入 .company-harness/tasks/<TASK>/ 文件；新上下文用 company_get_task 恢复（H-11）。\n- 成本护栏：COST_LEDGER.md 只记真实可获得用量，缺省记「不可获得」，禁止估算。\n- 批准门禁：公司模式在用户批准前不得进入编码（H-03）；自动模式必须把可逆低风险假设写入 DECISIONS.md，高风险任务（支付/权限/隐私/删除/迁移等）即使自动模式也强制等待批准（H-04）。',
      }))
    }

    // ================= Web API（Client 面板数据源） =================
    // 多会话挂载同一 preset 时 /company-api 路由由首个实例注册（进程全局）；
    // 任务数据均为文件态（.company-harness/**），任何实例读取结果一致，
    // 后续实例捕获 duplicate 错误后复用既有路由即可。
    const webServer = ctx.get('webServer')
    if (webServer !== undefined) {
      try {
        ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/company-api',
        handler: async function (req, res) {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const p = u.pathname
            const q = u.searchParams
            let out
            if (p === '/company-api/dashboard') out = { tasks: await listAllTasks() }
            else if (p === '/company-api/task') out = await taskDetail(q.get('taskId'))
            else if (p === '/company-api/tokens') out = await tokensSnapshot()
            else if (p === '/company-api/agents') out = { entries: agentLog.slice(-80), total: agentLog.length }
            else if (p === '/company-api/events') out = await eventsSnapshot(q)
            else if (p === '/company-api/flow') out = await flowSnapshot(q)
            else if (p === '/company-api/contract') out = await contractSnapshot(q)
            else if (p === '/company-api/canvas') out = await canvasSnapshot()
            else if (p === '/company-api/action') out = await handleAction(q.get('taskId'), q.get('action'), q)
            else { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
            res.end(JSON.stringify(sanitize(out)))
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: String((e && e.message) || e) }))
          }
        },
      }))
      } catch (e) {
        // 路由已由同 preset 的其他会话实例注册：复用既有路由（数据为文件态）
      }
    }

    // ================= 总监大画布页（/company） =================
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

    function ensureDir(dir) { try { nodeFs.mkdirSync(dir, { recursive: true }) } catch (e) {} }
    function renameDir(a, b) { nodeFs.renameSync(a, b) }

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

    async function explorationFileFor(hash) {
      const base = await defaultProjectDir()
      const dir = base + '/.company-harness/explorations'
      ensureDir(dir)
      return dir + '/' + hash + '.json'
    }

    const CONCURRENCY = { limit: 3 }
    async function setConcurrencyLimit(n) {
      CONCURRENCY.limit = n
      const base = await defaultProjectDir()
      appendEvent(createEventsFile(base + '/.company-harness/events'), { type: 'concurrency.changed', limit: n })
      return n
    }
    function activeAgents() {
      return agentLog.filter((e) => e.kind === 'start').length - agentLog.filter((e) => e.kind === 'end').length
    }

    async function issueContract(state, from, to, detail) {
      const c = buildContract({ from, to, ...detail })
      const errs = validateContract(c)
      if (errs.length) throw new Error('契约非法: ' + errs.join('; '))
      ensureDir(contractsDirOf(state))
      const file = contractsDirOf(state) + '/' + from + '__' + to + '.md'
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

    async function eventsSnapshot(q) {
      const base = await defaultProjectDir()
      const file = createEventsFile(base + '/.company-harness/events')
      const afterSeq = Number(q.get('seq') || 0)
      const events = readSince(file, afterSeq)
      return { events, nextSeq: events.length ? events[events.length - 1].seq : afterSeq }
    }

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

    async function contractSnapshot(q) {
      const state = await loadTask(q.get('taskId'))
      if (!state) return { error: '任务不存在' }
      const file = contractsDirOf(state) + '/' + q.get('from') + '__' + q.get('to') + '.md'
      const markdown = await readTextAt(file)
      return markdown === undefined ? { error: '契约不存在' } : { markdown }
    }

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

    async function dispatchFile() {
      const base = await defaultProjectDir()
      return base + '/.company-harness/dispatches.jsonl'
    }
    async function recordDispatch(d) { appendEvent(await dispatchFile(), d) }
    async function listDispatchRecords() {
      const text = await readTextAt(await dispatchFile())
      if (!text) return []
      return text.split('\n').filter(Boolean).map(function (l) { try { return JSON.parse(l) } catch (e) { return null } }).filter(Boolean)
    }

    async function taskDetail(taskId) {
      const state = await loadTask(taskId)
      if (!state) return { error: '任务不存在' }
      return {
        taskId: state.taskId, status: state.status, mode: state.mode,
        type: state.classification ? state.classification.type : null,
        requirement: state.requirement,
        currentSprint: state.currentSprint || null,
        sprints: state.sprints || [],
        replans: state.replans || 0,
        nextSteps: nextStepsFor(state),
        history: (state.history || []).slice(-12),
        updatedAt: state.updatedAt,
      }
    }

    async function handleAction(taskId, action, q) {
      // 无任务上下文的总监操作（先于 loadTask）
      if (action === 'concurrency') {
        const n = Number((q && q.get('n')) || 0)
        if (![2, 3, 4].includes(n)) return { ok: false, error: 'n 必须 2/3/4' }
        return { ok: true, limit: setConcurrencyLimit(n) }
      }
      if (action === 'hire' || action === 'upgradeDept' || action === 'undoHire') {
        const deptRoot = new URL('../../../../.agent-presets/', import.meta.url).pathname
        const evFile = createEventsFile(await defaultProjectDir() + '/.company-harness/events')
        if (action === 'hire') {
          const req = JSON.parse((q && q.get('req')) || 'null')
          if (!req) return { ok: false, error: 'req 必填' }
          const errs = validateHire(req)
          if (errs.length) return { ok: false, error: errs.join('; ') }
          const dir = deptRoot + 'company-dept-' + req.id
          ensureDir(dir)
          nodeFs.writeFileSync(dir + '/agent.cordis.yml', renderDeptPresetYml(req))
          nodeFs.writeFileSync(dir + '/preset.yml', 'name: company-dept-' + req.id + '\n')
          const roles = JSON.parse(nodeFs.readFileSync(ROLES_FILE, 'utf8'))
          try {
            const merged = mergeRole(roles.roles, { id: req.id, title: req.title, model: req.model, reasoning: req.reasoning, source: 'hired' })
            nodeFs.writeFileSync(ROLES_FILE, JSON.stringify({ specSection: roles.specSection, count: merged.length, note: roles.note, roles: merged }, null, 2))
          } catch (e) { return { ok: false, error: String(e.message || e) } }
          loadRoles()
          appendEvent(evFile, { type: 'dept.hired', dept: req.id, dir })
          return { ok: true, dir, role: req.id }
        }
        if (action === 'upgradeDept') {
          const req = JSON.parse((q && q.get('req')) || 'null')
          if (!req || !DEPT_ID_RE.test(req.id || '')) return { ok: false, error: 'req.id 非法' }
          const dir = deptRoot + 'company-dept-' + req.id
          nodeFs.writeFileSync(dir + '/agent.cordis.yml', renderDeptPresetYml(req))
          const roles = JSON.parse(nodeFs.readFileSync(ROLES_FILE, 'utf8'))
          const merged = roles.roles.map(function (r) {
            if (r.id === req.id) return { ...r, title: req.title, model: req.model, reasoning: req.reasoning }
            return r
          })
          nodeFs.writeFileSync(ROLES_FILE, JSON.stringify({ specSection: roles.specSection, count: merged.length, note: roles.note, roles: merged }, null, 2))
          loadRoles()
          appendEvent(evFile, { type: 'dept.upgraded', dept: req.id })
          return { ok: true }
        }
        const id = q.get('id')
        if (!DEPT_ID_RE.test(id || '')) return { ok: false, error: 'id 非法' }
        const roles = JSON.parse(nodeFs.readFileSync(ROLES_FILE, 'utf8'))
        try {
          const merged = undoRole(roles.roles, id)
          nodeFs.writeFileSync(ROLES_FILE, JSON.stringify({ specSection: roles.specSection, count: merged.length, note: roles.note, roles: merged }, null, 2))
        } catch (e) { return { ok: false, error: String(e.message || e) } }
        try { renameDir(deptRoot + 'company-dept-' + id, deptRoot + '.archived-company-dept-' + id) } catch (e) {}
        loadRoles()
        appendEvent(evFile, { type: 'dept.undone', dept: id })
        return { ok: true }
      }
      const state = await loadTask(taskId)
      if (!state) return { ok: false, error: '任务不存在' }
      if (action === 'approve') {
        if (state.status !== 'WAITING_INITIAL_APPROVAL') return { ok: false, error: '仅 WAITING_INITIAL_APPROVAL 可批准（当前 ' + state.status + '）' }
        const td = taskDirOf(state)
        const specPath = td + '/PRODUCT_SPEC.md'
        const planPath = td + '/SPRINT_PLAN.md'
        const specText = await readTextAt(specPath)
        const planText = await readTextAt(planPath)
        if (specText === undefined || planText === undefined) return { ok: false, error: '规格文件缺失' }
        if (/（待 Planner 填写）/.test(specText) || /（待填写）/.test(planText)) return { ok: false, error: '规格仍含「待填写」占位' }
        state.approvals.push({ at: now(), what: 'PRODUCT_SPEC.md + SPRINT_PLAN.md', by: 'user', source: 'user-ui', specChecksum: fnv1a(specText), planChecksum: fnv1a(planText) })
        await transition(state, 'SPRINT_DRAFTING', '用户通过 UI 面板批准产品规格与 Sprint 计划', [specPath, planPath])
        return { ok: true, status: state.status }
      }
      if (action === 'resume') {
        if (state.status !== 'PAUSED') return { ok: false, error: '仅 PAUSED 可恢复' }
        const back = state.pausedFrom || 'SPRINT_DRAFTING'
        await transition(state, back, '用户通过 UI 恢复：' + '面板操作', [taskDirOf(state) + '/RUN_STATE.json'])
        state.pausedFrom = null
        await saveState(state)
        return { ok: true, status: state.status }
      }
      if (action === 'pause') {
        if (state.status === 'PAUSED' || TERMINAL_STATES.indexOf(state.status) >= 0) return { ok: false, error: '不可暂停' }
        if ((state.sprints || []).length > 0) {
          const sid = state.currentSprint || state.sprints[state.sprints.length - 1].id
          if (await readTextAt(sprintDirOf(state, sid) + '/HANDOFF.md') === undefined) return { ok: false, error: '暂停前需 Recorder 刷新 HANDOFF.md' }
        }
        await transition(state, 'PAUSED', '用户通过 UI 暂停：面板操作', [taskDirOf(state) + '/HANDOFF.md'])
        return { ok: true, status: state.status }
      }
      if (action === 'terminate') {
        if (TERMINAL_STATES.indexOf(state.status) >= 0) return { ok: false, error: '已终态' }
        await transition(state, 'TERMINATED', '用户通过 UI 终止：面板操作', [taskDirOf(state) + '/RUN_STATE.json'])
        return { ok: true, status: state.status }
      }
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
      if (action === 'signContract') {
        const from = q.get('from'), to = q.get('to'), by = q.get('by') || 'user'
        if (!from || !to) return { ok: false, error: 'from/to 必填' }
        return await signContractFor(state, from, to, by)
      }
      if (action === 'decide') {
        const opt = q.get('opt')
        appendEvent(eventsFileFor(state), { type: 'adjudication.decided', taskId: state.taskId, decision: opt, by: 'director-ui' })
        return { ok: true, decision: opt }
      }
      return { ok: false, error: '未知操作' }
    }

    // ================= 工具注册（JSON Schema 参数） =================
    const S = (d) => ({ type: 'string', description: d })
    const SE = (d, values) => ({ type: 'string', enum: values, description: d })
    const B = (d) => ({ type: 'boolean', description: d })
    const SA = (d) => ({ type: 'array', items: { type: 'string' }, description: d })
    const N = (d) => ({ type: 'number', description: d })
    const I = (d) => ({ type: 'integer', description: d })
    function tool(name, description, properties, required, fn) {
      ctx.effect(() => ctx.tools.register({
        name,
        description,
        parameters: { type: 'object', additionalProperties: false, properties, required },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: function (args, value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
        },
        async execute(args) {
          try { return sanitize(await fn(args || {})) } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
        },
      }))
    }

    tool('company_start', '启动软件公司 Harness 任务（INTAKE→分类→发现→产品规划→批准门禁/自动推进）。这是所有变更请求的唯一入口：纯解释请求不要调用。', {
      requirement: S('一句话需求（原始用户需求，不加工）'),
      mode: SE('运行模式：company=默认公司模式（批准后自动执行）；auto=全自动公司模式（需记录可逆默认假设；高风险仍强制暂停等批准）；forced-full=强制完整公司模式；plan-only=只做规划', ['company', 'auto', 'forced-full', 'plan-only']),
      projectDir: S('项目目录（默认当前会话工作区）'),
      assumptions: SA('auto 模式必填：对可逆、低风险歧义的默认假设列表（写入 DECISIONS.md）'),
    }, ['requirement', 'mode'], async function (args) {
      const mode = args.mode
      const requirement = String(args.requirement || '').trim()
      if (!requirement) return { ok: false, error: 'requirement 不能为空' }
      const base = await resolveAbs(args.projectDir || (await defaultProjectDir()))
      await registerProject(base)
      const taskId = await allocTaskId(base)
      const cls = classify(requirement)
      let type = cls.type
      let team = teamFor(type)
      if (mode === 'forced-full') {
        team = teamFor('complex')
        if (type === 'small') { type = 'medium'; cls.forcedUpgrade = true }
      }
      const state = {
        schema: 1, taskId, projectDir: base, requirement, mode,
        createdAt: now(), updatedAt: now(),
        status: 'INTAKE', pausedFrom: null,
        classification: {
          type, factors: cls.factors, team,
          forceSecurityReview: type === 'high-risk',
          requireFinalE2E: type === 'complex' || type === 'high-risk' || mode === 'forced-full',
          reclassifiedAt: null, reclassReason: null,
        },
        sprints: [], currentSprint: null,
        replans: 0, finalRepairs: 0, repairPhase: null,
        flow: {
          template: type,
          nodes: (FLOW_TEMPLATES[type] || FLOW_TEMPLATES.small).nodes,
          adjustments: [],
          done: {},
        },
        approvals: [], history: [], rolesLaunched: [], ownershipConflicts: [],
      }
      const td = taskDirOf(state)
      const brief = '# TASK_BRIEF — ' + taskId + '\n\n- 创建时间：' + state.createdAt + '\n- 运行模式：' + mode + '\n- 项目目录：' + base + '\n- 一句话需求：' + requirement + '\n- 分类：' + type + '（' + JSON.stringify(cls.factors) + '）\n- 启动团队：' + team.join(', ') + '\n\n## 团队模型与 reasoning（H-02）\n\n| 角色 | 模型 | reasoning |\n| --- | --- | --- |\n' + team.map(function (r) { const d = ROLES[r]; return '| ' + d.title + ' | ' + d.model + ' | ' + d.reasoning + ' |' }).join('\n') + '\n\n## 协议摘要\n\n1. 批准前不修改任何业务代码（H-03）。\n2. 每轮编码前冻结 SPRINT_CONTRACT.md，完成标准冻结后不得修改。\n3. 文件所有权互斥；共享表面仅 Integrator 串行修改（H-06/H-07）。\n4. 任何 FAIL 直接路由全新 Repair Generator（deepseek-v4-pro/high）（H-09）。\n5. 两次定点修复 → 一次重新规划 → 仍失败暂停（H-10）。\n6. 新上下文只凭本目录文件与 Git 状态恢复（H-11）。\n'
      const spec = '# PRODUCT_SPEC — ' + taskId + '\n\n> 负责人：Planner（deepseek-v4-pro / high）。批准前可反复修订；批准后修改将记录在案。\n\n## 1. 产品目标\n\n（待 Planner 填写）\n\n## 2. 用户故事\n\n（待填写）\n\n## 3. 范围（In Scope）\n\n（待填写；必须是可观察、可验收的表述）\n\n## 4. 非目标（Out of Scope）\n\n（待填写）\n\n## 5. 可观察验收标准（草案，最终冻结于 SPRINT_CONTRACT.md）\n\n（待填写；禁止「界面高级」「体验良好」「功能完善」等不可判定措辞）\n\n## 6. 风险与开放问题\n\n（待填写）\n\n## 7. 批准记录\n\n- 无\n'
      const plan = '# SPRINT_PLAN — ' + taskId + '\n\n> 负责人：Planner。Sprint 路线、每轮目标、依赖顺序。\n\n## Sprint 路线\n\n| Sprint | 目标 | 可观察完成标准 | 依赖 |\n| --- | --- | --- | --- |\n| S01 | （待填写） | （待填写） | - |\n\n## 说明\n\n- 每轮一个可控功能块；完成标准在编码前冻结。\n- 小型任务仍使用标准 SPRINT_CONTRACT.md，但由 Coordinator 依据原始需求与现有确定性测试冻结。\n'
      const decisions = '# DECISIONS — ' + taskId + '\n\n> 负责人：Coordinator。记录决策与假设；聊天不是交接依据。\n\n## 决策记录\n\n- ' + now() + ' 创建任务，模式=' + mode + '，分类=' + type + '（自动分类，五个维度见 TASK_BRIEF.md）\n'
      const ledger = '# COST_LEDGER — ' + taskId + '\n\n> 负责人：Recorder。只记录真实可获得用量；不可获得一律记「不可获得」，禁止估算成事实。\n\n| 时间 | 角色 | 模型 | 目的 | 时长(ms) | 调用次数 | Tokens | 金额(USD) |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n'
      await writeJsonAt(td + '/RUN_STATE.json', state)
      await writeTextAt(td + '/TASK_BRIEF.md', brief)
      await writeTextAt(td + '/PRODUCT_SPEC.md', spec)
      await writeTextAt(td + '/SPRINT_PLAN.md', plan)
      await writeTextAt(td + '/DECISIONS.md', decisions)
      await writeTextAt(td + '/COST_LEDGER.md', ledger)
      await writeTextAt(td + '/WORK_OWNERSHIP.md', renderOwnership(state, []))
      if (type === 'complex' || type === 'high-risk' || mode === 'forced-full') {
        await writeTextAt(td + '/ARCHITECTURE.md', '# ARCHITECTURE — ' + taskId + '\n\n> 负责人：架构负责人（deepseek-v4-pro / high）。\n\n## 模块边界\n## 接口\n## 数据结构\n## 技术风险\n## 依赖顺序\n')
      }
      const rel = function (f) { return 'tasks/' + taskId + '/' + f }
      await transition(state, 'CLASSIFIED', '五维分类完成：' + type, [rel('TASK_BRIEF.md')])
      await transition(state, 'DISCOVERY', '发现阶段完成：规格与计划骨架就绪', [rel('PRODUCT_SPEC.md'), rel('SPRINT_PLAN.md')])
      await transition(state, 'PRODUCT_PLANNED', '产品规划骨架产出，待 Planner 填充', [rel('PRODUCT_SPEC.md'), rel('SPRINT_PLAN.md')])
      if (mode === 'plan-only') {
        return { ok: true, taskId, projectDir: base, mode, status: state.status, classification: state.classification, note: '只做规划：停在 PRODUCT_PLANNED，不进入任何编码流程', nextSteps: ['Planner 用 company_write_doc 填充 PRODUCT_SPEC/SPRINT_PLAN 后结束'] }
      }
      if (mode === 'company' || mode === 'forced-full') {
        await transition(state, 'WAITING_INITIAL_APPROVAL', '公司模式：等待用户批准 PRODUCT_SPEC.md 与 SPRINT_PLAN.md（批准前不修改业务代码）', [rel('PRODUCT_SPEC.md'), rel('SPRINT_PLAN.md')])
      } else {
        if (cls.type === 'high-risk') {
          await transition(state, 'WAITING_INITIAL_APPROVAL', '全自动模式安全门槛：高风险任务（支付/权限/隐私/删除/迁移等）必须等待批准', [rel('TASK_BRIEF.md')])
          return { ok: true, taskId, projectDir: base, mode, status: state.status, classification: state.classification, safetyNote: '自动模式遇高风险因子，已按 §17 强制暂停在批准门禁（H-04：全自动不等于无限授权）。', nextSteps: nextStepsFor(state), files: { taskDir: td } }
        }
        const assumptions = Array.isArray(args.assumptions) ? args.assumptions : []
        if (assumptions.length === 0) return { ok: false, error: '全自动公司模式必须记录可逆、低风险的默认假设（assumptions 至少 1 项，将写入 DECISIONS.md）' }
        await appendTextAt(td + '/DECISIONS.md', '\n## 全自动模式默认假设（' + now() + '）\n\n' + assumptions.map(function (a, i) { return (i + 1) + '. ' + a }).join('\n') + '\n')
        await transition(state, 'SPRINT_DRAFTING', '全自动模式：可逆低风险默认假设已记录于 DECISIONS.md，自动推进', [rel('DECISIONS.md')])
      }
      return { ok: true, taskId, projectDir: base, mode, status: state.status, classification: state.classification, safetyNote: '', nextSteps: nextStepsFor(state), files: { taskDir: td } }
    })

    tool('company_list_tasks', '列出所有已知 Harness 任务（跨项目注册表）的紧凑状态。', {
      projectDir: S('可选：只看某个项目目录'),
    }, [], async function (args) {
      return { ok: true, tasks: await listAllTasks(args.projectDir) }
    })

    tool('company_get_task', '读取任务完整快照：状态机、Sprint 判定、批准记录、所有权、历史、下一步指引、文件清单。新上下文恢复任务就靠它（H-11）。', {
      taskId: S('任务编号，如 TASK-20260126-001'),
    }, ['taskId'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      const td = taskDirOf(state)
      const files = await inventoryDir(td)
      const claims = parseClaims(await readTextAt(td + '/WORK_OWNERSHIP.md'))
      const activeWriters = claims.filter(function (c) { return c.active !== false }).map(function (c) { return c.role })
      const uniq = activeWriters.filter(function (v, i, a) { return a.indexOf(v) === i })
      const cap = CONCURRENCY_CAP[state.classification.type] || 3
      return {
        ok: true, taskId: state.taskId, projectDir: state.projectDir, requirement: state.requirement, mode: state.mode,
        status: state.status, pausedFrom: state.pausedFrom, classification: state.classification,
        currentSprint: state.currentSprint, sprints: state.sprints, replans: state.replans, finalRepairs: state.finalRepairs, repairPhase: state.repairPhase,
        approvals: state.approvals, history: (state.history || []).slice(-15),
        rolesLaunched: (state.rolesLaunched || []).slice(-15),
        ownership: claims, ownershipConflicts: state.ownershipConflicts || [],
        concurrency: { activeWriterRoles: uniq, cap, warning: uniq.length > cap ? '活动写入角色数 ' + uniq.length + ' 超过并发上限 ' + cap : null },
        nextSteps: nextStepsFor(state),
        files: files.map(function (f) { return f.slice(td.length + 1) }),
        updatedAt: state.updatedAt,
      }
    })

    tool('company_get_role', '读取角色库定义（职责、禁止事项、模型与 reasoning），用于按角色派工/生成子代理提示词。', {
      role: S('角色 id'),
    }, ['role'], async function (args) {
      const def = ROLES[args.role]
      if (!def) return { ok: false, error: '未知角色 ' + args.role + '；可选: ' + Object.keys(ROLES).join(', ') }
      return { ok: true, role: def }
    })

    tool('company_list_roles', '列出角色库全部 14 个角色（13 常设 + 1 修复触发）：id、中文名、模型、reasoning、职责、禁止事项。角色权威记录见 preset roles/ROLES.md 与项目 .company-harness/ROLES.md。', {}, [], async function () {
      return { ok: true, count: Object.keys(ROLES).length, roles: Object.keys(ROLES).map(function (k) { return ROLES[k] }) }
    })

    tool('company_write_doc', '按文件所有权写入任务文档（唯一负责人校验 + 阶段门禁）。聊天不是交接依据，一切以签文件为准。', {
      taskId: S('任务编号'),
      doc: SE('文档类型（SPRINT_CONTRACT 不在此列，必须走 company_freeze_contract）', Object.keys(DOC_OWNERS)),
      content: S('Markdown 内容'),
      authorRole: S('执行写入的角色 id（必须与该文档唯一负责人一致）'),
      sprintId: S('Sprint 文档（IMPLEMENTATION/QA_EVIDENCE/QA_REPORT/HANDOFF）必填'),
      append: B('是否追加（默认：DECISIONS/COST_LEDGER/IMPLEMENTATION/QA_EVIDENCE/QA_REPORT 追加，其余覆盖）'),
    }, ['taskId', 'doc', 'content', 'authorRole'], async function (args) { return await writeDoc(args) })

    tool('company_approve', '用户批准 PRODUCT_SPEC.md 与 SPRINT_PLAN.md（公司模式批准门禁；H-03）。只有用户明确批准或 UI 面板【批准】后才能调用；带 feedback 则退回规划阶段修订。', {
      taskId: S('任务编号'),
      feedback: S('用户修改意见（非空则退回 PRODUCT_PLANNED 修订，不批准）'),
      source: SE('批准来源：user-instructed=用户明确指示；user-ui=用户点击面板按钮。默认 user-instructed', ['user-instructed', 'user-ui']),
    }, ['taskId'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      if (state.status !== 'WAITING_INITIAL_APPROVAL') return { ok: false, error: '当前状态 ' + state.status + '，批准仅适用于 WAITING_INITIAL_APPROVAL' }
      const source = args.source === 'user-ui' ? 'user-ui' : 'user-instructed'
      const td = taskDirOf(state)
      if (typeof args.feedback === 'string' && args.feedback.trim()) {
        await appendTextAt(td + '/DECISIONS.md', '\n## 用户修改意见（' + now() + '）\n\n' + args.feedback.trim() + '\n')
        await transition(state, 'PRODUCT_PLANNED', '用户提出修改意见，退回规划：' + args.feedback.trim().slice(0, 140), [td + '/DECISIONS.md'])
        return { ok: true, taskId: state.taskId, status: 'PRODUCT_PLANNED', note: '已退回规划阶段，请 Planner 按意见修订 PRODUCT_SPEC/SPRINT_PLAN 后再批准' }
      }
      const specPath = td + '/PRODUCT_SPEC.md'
      const planPath = td + '/SPRINT_PLAN.md'
      const specText = await readTextAt(specPath)
      const planText = await readTextAt(planPath)
      if (specText === undefined || planText === undefined) return { ok: false, error: 'PRODUCT_SPEC.md 或 SPRINT_PLAN.md 缺失，无法批准' }
      if (/（待 Planner 填写）/.test(specText) || /（待填写）/.test(planText)) return { ok: false, error: '规格或计划仍含「待填写」占位，Planner 必须完成后才能提交批准' }
      state.approvals.push({ at: now(), what: 'PRODUCT_SPEC.md + SPRINT_PLAN.md', by: 'user', source, specChecksum: fnv1a(specText), planChecksum: fnv1a(planText) })
      await transition(state, 'SPRINT_DRAFTING', '用户批准产品规格与 Sprint 计划（来源：' + source + '）', [specPath, planPath])
      return { ok: true, taskId: state.taskId, status: 'SPRINT_DRAFTING', approvals: state.approvals, nextSteps: nextStepsFor(state) }
    })

    tool('company_reclassify', 'Coordinator 在编码开始前调整任务分类/团队（例如小型任务被判定需要视觉或边界判断时提升为中型）。编码开始后禁止改动。', {
      taskId: S('任务编号'),
      type: SE('新分类', ['small', 'medium', 'complex', 'high-risk']),
      reason: S('重新分类的理由（写入历史）'),
    }, ['taskId', 'type', 'reason'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      if (['CONTRACT_SIGNED', 'IMPLEMENTING', 'SELF_CHECK', 'INTEGRATING', 'QA_RUNNING', 'REPAIRING', 'REPLANNING', 'SPRINT_PASSED', 'FINAL_E2E'].indexOf(state.status) >= 0) {
        return { ok: false, error: '编码流程已开始（当前 ' + state.status + '），分类不可再改；只能通过正式返工流程处理' }
      }
      state.classification.type = args.type
      state.classification.team = teamFor(args.type)
      state.classification.forceSecurityReview = args.type === 'high-risk'
      state.classification.requireFinalE2E = args.type === 'complex' || args.type === 'high-risk' || state.mode === 'forced-full'
      state.classification.reclassifiedAt = now()
      state.classification.reclassReason = args.reason
      state.history.push({ at: now(), from: state.status, to: state.status, reason: '重新分类 → ' + args.type + '：' + args.reason, refs: [taskDirOf(state) + '/TASK_BRIEF.md'] })
      await saveState(state)
      return { ok: true, taskId: state.taskId, classification: state.classification }
    })

    tool('company_set_state', 'Coordinator 推进状态机。转换必须引用文件/commit/测试证据 refs；非法转换会被拒绝。仅 Coordinator 可调用。', {
      taskId: S('任务编号'),
      to: SE('目标状态', ['CLASSIFIED', 'DISCOVERY', 'PRODUCT_PLANNED', 'WAITING_INITIAL_APPROVAL', 'SPRINT_DRAFTING', 'CONTRACT_REVIEW', 'CONTRACT_SIGNED', 'IMPLEMENTING', 'SELF_CHECK', 'INTEGRATING', 'QA_RUNNING', 'SPRINT_PASSED', 'REPAIRING', 'REPLANNING', 'FINAL_E2E', 'RELEASED']),
      reason: S('转换理由'),
      refs: SA('证据引用（文件路径 / commit / 测试结果，至少 1 项）'),
    }, ['taskId', 'to', 'reason', 'refs'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      if (args.to === 'RELEASED') {
        const small = state.classification && state.classification.type === 'small' && state.mode !== 'forced-full'
        const allPassed = state.sprints && state.sprints.length > 0 && state.sprints.every(function (x) { return x.status === 'PASSED' })
        const cur = (state.sprints || []).find(function (x) { return x.id === state.currentSprint })
        const mediumDeterministic = state.classification && state.classification.type === 'medium' && state.mode !== 'forced-full' && allPassed && cur && cur.deterministicCoverage === true
        if (!small && !mediumDeterministic) return { ok: false, error: '中型及以上任务不得跳过最终端到端验收（FINAL_E2E）；medium 仅当全部 Sprint PASSED 且当前 Sprint deterministicCoverage=true（sprint-evaluator 已签发且验收标准全部确定性覆盖）时才允许直接 RELEASED' }
        if (small && (!cur || cur.deterministicCoverage !== true)) return { ok: false, error: '缺少确定性覆盖声明，必须先通过 company_freeze_contract(deterministicCoverage=true) 或提升任务等级' }
      }
      if (args.to === 'FINAL_E2E' && state.sprints.filter(function (x) { return x.status === 'PASSED' }).length !== state.sprints.length) {
        return { ok: false, error: '还有 Sprint 未 PASS，不能进入最终验收' }
      }
      await transition(state, args.to, args.reason, args.refs)
      return { ok: true, taskId: state.taskId, status: state.status, nextSteps: nextStepsFor(state) }
    })

    tool('company_freeze_contract', '冻结并签署本轮 SPRINT_CONTRACT.md。小型任务由 Coordinator 冻结（deterministicCoverage 必须为 true，否则必须提升为中型）；中型+由 Sprint Evaluator 在 CONTRACT_REVIEW 后签署。冻结后合同不可重写，Generator 不得修改验收标准。', {
      taskId: S('任务编号'),
      sprintId: S('Sprint 编号，如 S01'),
      contract: S('完整合同 Markdown（目标、非目标、用户操作、可观察结果、证据、必测项、失败定义、所有权）'),
      frozenBy: SE('签署角色', ['coordinator', 'sprint-evaluator']),
      deterministicCoverage: B('小型任务必填：全部验收标准是否由确定性自动测试完整覆盖'),
      finalSprint: B('是否计划中的最后一个 Sprint'),
    }, ['taskId', 'sprintId', 'contract', 'frozenBy'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      if (state.status !== 'SPRINT_DRAFTING' && state.status !== 'CONTRACT_REVIEW') {
        return { ok: false, error: '当前状态 ' + state.status + ' 不允许冻结合同（需 SPRINT_DRAFTING 或 CONTRACT_REVIEW）' }
      }
      if ((state.sprints || []).find(function (x) { return x.id === args.sprintId })) {
        return { ok: false, error: 'Sprint ' + args.sprintId + ' 合同已冻结，合同不可重写' }
      }
      const small = state.classification && state.classification.type === 'small' && state.mode !== 'forced-full'
      if (small) {
        if (args.frozenBy !== 'coordinator') return { ok: false, error: '小型任务合同由 Coordinator 冻结（精简门禁不启动 Sprint Evaluator）' }
        if (args.deterministicCoverage !== true) {
          return { ok: false, code: 'MUST_UPGRADE_TO_MEDIUM', error: '自动测试无法完整覆盖全部验收标准 → 编码前必须提升为中型任务（company_reclassify）并启动 Sprint Evaluator；小型任务不允许带主观/视觉/交互/边界判断的标准进入编码' }
        }
      } else {
        if (args.frozenBy !== 'sprint-evaluator') return { ok: false, error: '中型+任务合同必须由 Sprint Evaluator 评审后签署' }
        if ((state.classification.team || []).indexOf('sprint-evaluator') < 0) return { ok: false, error: '团队未启动 Sprint Evaluator（先 company_record_role 登记或 company_reclassify）' }
        if (state.status !== 'CONTRACT_REVIEW') return { ok: false, error: '中型+任务必须先进入 CONTRACT_REVIEW（company_set_state），评估者评审后才能签署' }
      }
      const checksum = fnv1a(args.contract)
      const header = '# SPRINT_CONTRACT — ' + state.taskId + ' / ' + args.sprintId + '\n\n- 冻结时间：' + now() + '\n- 签署角色：' + args.frozenBy + '\n- 任务类型：' + state.classification.type + '\n- 确定性门禁（小型）：' + (small ? 'true（' + args.deterministicCoverage + '）' : '不适用') + '\n- 计划末轮：' + (args.finalSprint === true ? '是' : '否') + '\n- 合同校验值：' + checksum + '\n\n> 冻结后合同不可修改；Generator 不得修改验收标准来迎合实现；Evaluator 不得顺手修代码。\n\n' + args.contract + '\n'
      const sd = sprintDirOf(state, args.sprintId)
      await writeTextAt(sd + '/SPRINT_CONTRACT.md', header)
      state.sprints.push({
        id: args.sprintId, status: 'SIGNED', repairAttempts: 0, verdicts: [], implementers: [],
        contractChecksum: checksum, deterministicCoverage: small ? args.deterministicCoverage === true : false,
        finalSprint: args.finalSprint === true, contractSignedAt: now(),
      })
      state.currentSprint = args.sprintId
      await transition(state, 'CONTRACT_SIGNED', 'Sprint 合同已冻结签署（' + args.frozenBy + '，校验值 ' + checksum + '）', [sd + '/SPRINT_CONTRACT.md'])
      return { ok: true, taskId: state.taskId, sprintId: args.sprintId, checksum, status: state.status, nextSteps: nextStepsFor(state) }
    })

    tool('company_claim', '声明文件/目录所有权（WORK_OWNERSHIP.md）。路径与既有声明重叠即 OWNERSHIP_CONFLICT（保留现场、不自动回滚）；共享表面只能由 Integrator 声明。release=true 释放声明。', {
      taskId: S('任务编号'),
      role: S('声明角色 id（实现类角色）'),
      paths: SA('文件或目录路径（相对项目根）'),
      worktree: S('绑定的 worktree（如 <project>-company-worktrees/TASK-001/frontend）'),
      branch: S('绑定的独立分支'),
      release: B('true=释放这些声明（active=false）'),
    }, ['taskId', 'role', 'paths'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      if (['INTAKE', 'CLASSIFIED', 'DISCOVERY', 'PRODUCT_PLANNED', 'WAITING_INITIAL_APPROVAL'].indexOf(state.status) >= 0) {
        return { ok: false, error: '批准/合同阶段之前不能声明写入所有权（当前 ' + state.status + '）' }
      }
      const td = taskDirOf(state)
      const existing = parseClaims(await readTextAt(td + '/WORK_OWNERSHIP.md'))
      const paths = (args.paths || []).map(normalizeClaimPath)
      if (paths.length === 0) return { ok: false, error: 'paths 不能为空' }
      for (const p of paths) {
        if (isSharedSurface(p) && args.role !== 'integrator') {
          return { ok: false, code: 'SHARED_SURFACE', error: '「' + p + '」是共享表面（依赖锁文件/迁移/CI/部署配置/共享令牌/生成文件），只能由唯一 Integrator 串行修改（H-07）' }
        }
      }
      if (args.release === true) {
        let n = 0
        for (const c of existing) {
          if (c.role === args.role) {
            const hit = paths.some(function (p) { return (c.paths || []).some(function (cp) { return pathsOverlap(normalizeClaimPath(cp), p) }) })
            if (hit) { c.active = false; n++ }
          }
        }
        await writeTextAt(td + '/WORK_OWNERSHIP.md', renderOwnership(state, existing))
        state.history.push({ at: now(), from: state.status, to: state.status, reason: args.role + ' 释放所有权声明（' + n + ' 项）', refs: [td + '/WORK_OWNERSHIP.md'] })
        await saveState(state)
        return { ok: true, released: n, role: args.role }
      }
      for (const c of existing) {
        if (c.active === false) continue
        if (c.role === args.role) continue
        for (const p of paths) {
          for (const cp of c.paths || []) {
            if (pathsOverlap(normalizeClaimPath(cp), p)) {
              const conflict = { at: now(), incoming: { role: args.role, paths: args.paths, worktree: args.worktree || null, branch: args.branch || null }, existing: { role: c.role, paths: c.paths, worktree: c.worktree || null, branch: c.branch || null } }
              state.ownershipConflicts.push(conflict)
              await saveState(state)
              return { ok: false, code: 'OWNERSHIP_CONFLICT', error: '所有权冲突：' + args.role + ' 的「' + p + '」与 ' + c.role + ' 的「' + cp + '」重叠。已停止后进入者、保留现场（不自动回滚），Coordinator 标记 OWNERSHIP_CONFLICT，由 Integrator 重新划分或串行处理', conflict }
            }
          }
        }
      }
      for (const p of args.paths) {
        const mine = existing.find(function (c) { return c.role === args.role && c.active !== false && (c.paths || []).some(function (cp) { return normalizeClaimPath(cp) === normalizeClaimPath(p) }) })
        if (!mine) existing.push({ role: args.role, paths: [p], worktree: args.worktree || null, branch: args.branch || null, since: now(), active: true })
      }
      await writeTextAt(td + '/WORK_OWNERSHIP.md', renderOwnership(state, existing))
      state.history.push({ at: now(), from: state.status, to: state.status, reason: args.role + ' 声明所有权：' + args.paths.join(', '), refs: [td + '/WORK_OWNERSHIP.md'] })
      await saveState(state)
      return { ok: true, claims: existing.filter(function (c) { return c.active !== false }), note: '共享表面仅 Integrator；并行写入前确认 worktree/分支独立、接口与数据结构已冻结' }
    })

    tool('company_record_role', '登记实际启动的角色及模型/reasoning（H-02 硬校验：Coordinator 必须 max，其余必须与角色库一致；不一致拒绝登记）。', {
      taskId: S('任务编号'),
      role: S('角色 id'),
      model: S('实际使用模型'),
      reasoning: S('实际 reasoning（max/high/low）'),
      purpose: S('本次启动目的（实现类角色写 implement，评估类写 review，供独立性校验）'),
    }, ['taskId', 'role', 'model', 'reasoning'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      const def = ROLES[args.role]
      if (!def) return { ok: false, error: '未知角色 ' + args.role + '；可选: ' + Object.keys(ROLES).join(', ') }
      if (args.model !== def.model || args.reasoning !== def.reasoning) {
        return { ok: false, code: 'MODEL_CONSTRAINT', error: 'H-02 模型约束：' + def.title + ' 必须是 ' + def.model + ' / ' + def.reasoning + '，收到 ' + args.model + ' / ' + args.reasoning }
      }
      state.rolesLaunched.push({ at: now(), role: args.role, model: args.model, reasoning: args.reasoning, purpose: String(args.purpose || '') })
      await saveState(state)
      return { ok: true, taskId: state.taskId, role: args.role, model: args.model, reasoning: args.reasoning }
    })

    tool('company_record_cost', '向 COST_LEDGER.md 追加一条成本记录。只记录真实可获得用量；tokens/dollars/durationMs/calls 缺省一律记「不可获得」，禁止估算。', {
      taskId: S('任务编号'),
      role: S('角色 id'),
      model: S('模型'),
      purpose: S('本次调用的目的'),
      durationMs: I('真实时长（毫秒），缺省=不可获得'),
      calls: I('真实调用次数，缺省=不可获得'),
      tokens: I('真实 Token 用量，缺省=不可获得'),
      dollars: N('真实金额（USD），缺省=不可获得'),
    }, ['taskId', 'role', 'model', 'purpose'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      const v = function (x) { return x === undefined || x === null ? '不可获得' : String(x) }
      await appendTextAt(taskDirOf(state) + '/COST_LEDGER.md', '| ' + now() + ' | ' + args.role + ' | ' + args.model + ' | ' + String(args.purpose || '-') + ' | ' + v(args.durationMs) + ' | ' + v(args.calls) + ' | ' + v(args.tokens) + ' | ' + v(args.dollars) + ' |')
      return { ok: true, taskId: state.taskId, recorded: true }
    })

    tool('company_verdict', '签发 PASS/FAIL 判定（Sprint Evaluator；小型确定性门禁可由 Coordinator 依确定性测试结果签发）。FAIL 自动进入硬路由：全新 Repair Generator（deepseek-v4-pro/high）→ 复验；两次修复后重新规划一次；重新规划后仍失败直接暂停。评估者不得参与本轮编码（H-08/H-09/H-10）。', {
      taskId: S('任务编号'),
      scope: SE('sprint=单轮判定；final=最终端到端验收', ['sprint', 'final']),
      sprintId: S('scope=sprint 时必填'),
      verdict: SE('判定结果', ['PASS', 'FAIL']),
      by: S('签发角色：sprint-evaluator / final-evaluator / coordinator（仅小型确定性门禁）'),
      report: S('判定报告（证据与结论；失败必须含复现步骤）'),
      refs: SA('证据引用（测试输出/截图路径/commit，至少 1 项）'),
    }, ['taskId', 'scope', 'verdict', 'by', 'report', 'refs'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      if (args.scope === 'sprint') {
        if (state.status !== 'QA_RUNNING') return { ok: false, error: 'Sprint 判定只能在 QA_RUNNING 状态签发（当前 ' + state.status + '）' }
        const sprintId = args.sprintId
        const sprint = (state.sprints || []).find(function (x) { return x.id === sprintId })
        if (!sprint) return { ok: false, error: 'Sprint ' + sprintId + ' 不存在' }
        const small = state.classification && state.classification.type === 'small' && state.mode !== 'forced-full'
        if (small && sprint.deterministicCoverage === true) {
          if (args.by !== 'coordinator' && args.by !== 'sprint-evaluator') return { ok: false, error: '小型确定性门禁只能由 Coordinator 或 Sprint Evaluator 签发' }
        } else {
          if (args.by !== 'sprint-evaluator') return { ok: false, error: '该任务必须由独立 Sprint Evaluator 签发判定' }
        }
        if (sprint.implementers.indexOf(args.by) >= 0) return { ok: false, code: 'EVALUATOR_CONFLICT', error: 'H-08：' + args.by + ' 参与了本轮编码，不得为同一轮签发判定' }
        if (args.by === 'sprint-evaluator') {
          const la = (state.rolesLaunched || []).filter(function (r) { return r.role === 'sprint-evaluator' }).some(function (r) { return /implement|实现|编码/i.test(r.purpose || '') })
          if (la) return { ok: false, code: 'EVALUATOR_CONFLICT', error: 'H-08：sprint-evaluator 有实现类启动记录，不得签发判定' }
        }
        const sd = sprintDirOf(state, sprintId)
        if (await readTextAt(sd + '/QA_EVIDENCE.md') === undefined) return { ok: false, error: '缺少 QA_EVIDENCE.md（QA 执行员证据），不能签发判定' }
        if (args.by === 'sprint-evaluator' && await readTextAt(sd + '/QA_REPORT.md') === undefined) return { ok: false, error: '缺少 QA_REPORT.md（Sprint Evaluator 报告）' }
        if (args.verdict === 'PASS') {
          sprint.status = 'PASSED'
          sprint.verdicts.push({ verdict: 'PASS', by: args.by, at: now(), refs: args.refs, report: args.report })
          if (args.by === 'sprint-evaluator') await appendTextAt(sd + '/QA_REPORT.md', '\n## 判定（' + now() + '）\n\n**PASS** — ' + args.by + '\n\n' + args.report + '\n\n证据：' + args.refs.join('、') + '\n')
          await transition(state, 'SPRINT_PASSED', 'Sprint ' + sprintId + ' 验收 PASS（' + args.by + '）', args.refs)
          return { ok: true, taskId: state.taskId, sprintId, verdict: 'PASS', status: state.status, nextSteps: nextStepsFor(state) }
        }
        sprint.verdicts.push({ verdict: 'FAIL', by: args.by, at: now(), refs: args.refs, report: args.report })
        if (await readTextAt(sd + '/HANDOFF.md') === undefined) return { ok: false, error: 'FAIL 后必须由 Recorder 先刷新 HANDOFF.md（§15：连续失败必须刷新交接文件）' }
        if (args.by === 'sprint-evaluator') await appendTextAt(sd + '/QA_REPORT.md', '\n## 判定（' + now() + '）\n\n**FAIL** — ' + args.by + '\n\n' + args.report + '\n\n证据：' + args.refs.join('、') + '\n')
        sprint.repairAttempts++
        state.repairPhase = 'sprint'
        if (sprint.repairAttempts <= 2 && (state.replans || 0) === 0) {
          await transition(state, 'REPAIRING', '验收 FAIL（第 ' + sprint.repairAttempts + ' 次）→ 硬路由：启动全新 Repair Generator（deepseek-v4-pro/high）定点修复；QA 重新取证；全新 Evaluator 上下文复验', args.refs)
        } else if ((state.replans || 0) === 0) {
          await transition(state, 'REPLANNING', '两次定点修复后仍 FAIL → Planner＋架构负责人重新规划一次；Coordinator(Max) 确认仍在已批准范围后重实现', args.refs)
        } else {
          state.pausedFrom = 'QA_RUNNING'
          await transition(state, 'PAUSED', '重新规划后仍 FAIL → 暂停，向用户提交证据与决策选项（H-10）', args.refs)
        }
        return { ok: true, taskId: state.taskId, sprintId, verdict: 'FAIL', repairAttempts: sprint.repairAttempts, status: state.status, note: state.status === 'REPAIRING' ? '硬路由：全新 Repair Generator（deepseek-v4-pro/high），禁止先交给 Flash 修复；修复后 company_set_state → QA_RUNNING' : '' }
      }
      if (state.status !== 'FINAL_E2E') return { ok: false, error: '最终判定只能在 FINAL_E2E 状态签发（当前 ' + state.status + '）' }
      if (args.by !== 'final-evaluator') return { ok: false, error: '最终验收必须由最终验收负责人（final-evaluator）签发' }
      const la2 = (state.rolesLaunched || []).filter(function (r) { return r.role === 'final-evaluator' }).some(function (r) { return /implement|实现|编码/i.test(r.purpose || '') })
      if (la2) return { ok: false, code: 'EVALUATOR_CONFLICT', error: 'H-08：final-evaluator 有实现类启动记录，不得签发最终判定' }
      const faPath = taskDirOf(state) + '/FINAL_ACCEPTANCE.md'
      if (args.verdict === 'PASS') {
        const reportMd = '# FINAL_ACCEPTANCE — ' + state.taskId + '\n\n- 判定时间：' + now() + '\n- 判定人：final-evaluator（' + ROLES['final-evaluator'].model + ' / ' + ROLES['final-evaluator'].reasoning + '）\n- 结论：PASS\n- 证据：' + args.refs.join('、') + '\n\n' + args.report + '\n'
        await writeTextAt(faPath, reportMd)
        await transition(state, 'RELEASED', '最终端到端验收 PASS（final-evaluator，真实 UI/API/数据/测试证据）', args.refs.concat([faPath]))
        const receipt = await buildReceipt(state)
        await appendTextAt(faPath, '\n## 项目收据\n\n```text\n' + receipt + '\n```\n')
        return { ok: true, taskId: state.taskId, verdict: 'PASS', status: state.status, receipt }
      }
      if (await readTextAt(faPath) === undefined) await writeTextAt(faPath, '# FINAL_ACCEPTANCE — ' + state.taskId + '\n\n## 判定历史\n\n')
      await appendTextAt(faPath, '\n## FAIL（' + now() + '）\n\n' + args.report + '\n\n证据：' + args.refs.join('、') + '\n')
      state.finalRepairs = (state.finalRepairs || 0) + 1
      state.repairPhase = 'final'
      if (state.finalRepairs <= 2 && (state.replans || 0) === 0) {
        await transition(state, 'REPAIRING', '最终验收 FAIL（第 ' + state.finalRepairs + ' 次）→ 全新 Repair Generator（deepseek-v4-pro/high）定点修复；修复后全量回归，全新最终验收上下文复验', args.refs)
      } else if ((state.replans || 0) === 0) {
        await transition(state, 'REPLANNING', '最终验收两次修复仍 FAIL → Planner＋架构负责人重新规划一次', args.refs)
      } else {
        state.pausedFrom = 'FINAL_E2E'
        await transition(state, 'PAUSED', '最终验收重新规划后仍 FAIL → 暂停，向用户提交证据与决策选项（H-10）', args.refs)
      }
      return { ok: true, taskId: state.taskId, verdict: 'FAIL', finalRepairs: state.finalRepairs, status: state.status }
    })

    tool('company_start_repair', '在 REPAIRING 状态下获取冻结的修复上下文（失败报告、合同、修复预算、模型要求）。修复必须由全新 Repair Generator（deepseek-v4-pro/high）执行，不扩大范围、不重写合同、不自行放行。', {
      taskId: S('任务编号'),
    }, ['taskId'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      if (state.status !== 'REPAIRING') return { ok: false, error: '当前状态 ' + state.status + '，只有 REPAIRING 可启动修复' }
      const phase = state.repairPhase === 'final' ? 'final' : 'sprint'
      const sprintId = state.currentSprint
      const sprint = (state.sprints || []).find(function (x) { return x.id === sprintId })
      const attempt = phase === 'final' ? state.finalRepairs : (sprint ? sprint.repairAttempts : 0)
      const lastFail = sprint ? sprint.verdicts.filter(function (v) { return v.verdict === 'FAIL' }).slice(-1)[0] : null
      return {
        ok: true, taskId: state.taskId, phase, sprintId: phase === 'sprint' ? sprintId : null,
        attempt, budget: '每轮最多 2 次定点修复；第 2 次后若仍 FAIL 将重新规划一次；重新规划后仍 FAIL 直接暂停（H-10）',
        model: 'deepseek-v4-pro', reasoning: 'high',
        frozenContext: {
          contract: phase === 'sprint' ? sprintDirOf(state, sprintId) + '/SPRINT_CONTRACT.md' : null,
          lastFailure: lastFail ? { at: lastFail.at, refs: lastFail.refs } : null,
          failureReport: phase === 'sprint' ? sprintDirOf(state, sprintId) + '/QA_REPORT.md' : taskDirOf(state) + '/FINAL_ACCEPTANCE.md',
        },
        rules: ['全新上下文（不看聊天历史，只读冻结文件与 Git 状态）', '定点修复失败报告，不扩大范围', '不重写合同、不修改验收标准', '输出独立 repair commit', '不自行宣布通过：修复后必须重跑测试并回到 QA_RUNNING/FINAL_E2E 由全新评估上下文复验'],
        nextSteps: ['company_record_role 登记 repair-generator（deepseek-v4-pro/high）', '修复完成后 company_set_state → QA_RUNNING（sprint）或 → FINAL_E2E（final），refs 附 repair commit'],
      }
    })

    tool('company_control', '暂停/恢复/终止任务。暂停与终止要求 Recorder 已刷新 HANDOFF.md（上下文连续性 §15）。', {
      taskId: S('任务编号'),
      action: SE('操作', ['pause', 'resume', 'terminate']),
      reason: S('原因（写入历史）'),
    }, ['taskId', 'action', 'reason'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      const td = taskDirOf(state)
      if (args.action === 'resume') {
        if (state.status !== 'PAUSED') return { ok: false, error: '只有 PAUSED 状态可恢复（当前 ' + state.status + '）' }
        const back = state.pausedFrom || 'SPRINT_DRAFTING'
        await transition(state, back, '恢复：' + args.reason, [td + '/HANDOFF.md', td + '/RUN_STATE.json'])
        state.pausedFrom = null
        await saveState(state)
        return { ok: true, taskId: state.taskId, status: state.status, nextSteps: nextStepsFor(state) }
      }
      if (args.action === 'pause') {
        if (state.status === 'PAUSED' || TERMINAL_STATES.indexOf(state.status) >= 0) return { ok: false, error: '当前状态 ' + state.status + ' 不能暂停' }
      } else {
        if (TERMINAL_STATES.indexOf(state.status) >= 0) return { ok: false, error: '已处于终态 ' + state.status }
      }
      if ((state.sprints || []).length > 0) {
        const sid = state.currentSprint || state.sprints[state.sprints.length - 1].id
        const h = await readTextAt(sprintDirOf(state, sid) + '/HANDOFF.md')
        if (h === undefined) return { ok: false, error: args.action === 'pause' ? '暂停前必须由 Recorder 刷新 HANDOFF.md（§15 上下文连续性）' : '终止前必须由 Recorder 刷新 HANDOFF.md' }
      }
      if (args.action === 'pause') {
        await transition(state, 'PAUSED', '暂停：' + args.reason, [td + '/HANDOFF.md'])
        return { ok: true, taskId: state.taskId, status: 'PAUSED', pausedFrom: state.pausedFrom }
      }
      await transition(state, 'TERMINATED', '终止：' + args.reason, [td + '/HANDOFF.md'])
      const receipt = await buildReceipt(state)
      await appendTextAt(td + '/FINAL_ACCEPTANCE.md', '\n## 终止收据\n\n```text\n' + receipt + '\n```\n')
      return { ok: true, taskId: state.taskId, status: 'TERMINATED', receipt }
    })

    tool('company_receipt', '生成项目收据（§19）：状态、批准规格校验值、Sprint 完成数、集成 commit、合同通过数、修复/重规划次数、实际启动角色、测试证据、成本说明。不估算任何不可获得的数字。', {
      taskId: S('任务编号'),
    }, ['taskId'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在：' + args.taskId }
      const receipt = await buildReceipt(state)
      await appendTextAt(taskDirOf(state) + '/FINAL_ACCEPTANCE.md', '\n## 项目收据（' + now() + '）\n\n```text\n' + receipt + '\n```\n')
      return { ok: true, taskId: state.taskId, receipt }
    })

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

    tool('company_run_sprint', '复合驱动（五刀①进阶项）：一个回合内按 DAG 就绪关系生成本 Sprint 的全部派工计划（含每个环节的角色、注入的契约切片路径与派工提示词），并推进状态登记。实际子代理派工由 Coordinator 按计划用 subagent 工具执行（可多路并行，遵守并发上限）。裁决点不在此工具内。', {
      taskId: S('任务编号'),
    }, ['taskId'], async function (args) {
      const state = await loadTask(args.taskId)
      if (!state) return { ok: false, error: '任务不存在' }
      if (!state.flow) return { ok: false, error: '旧任务无 DAG 流程' }
      const done = new Set(Object.keys(state.flow.done || {}))
      const plan = []
      let changed = false
      for (let guard = 0; guard < state.flow.nodes.length + 2; guard += 1) {
        const ready = readyNodes(state.flow, done)
        if (ready.length === 0) break
        const nodeId = ready[0]
        const node = state.flow.nodes.find((n) => n.id === nodeId)
        if (!node) break
        const dept = ROLES[node.dept] || { title: node.dept, model: 'deepseek-v4-flash', reasoning: 'high' }
        const contractSlices = (state.flow.nodes || [])
          .filter((n) => (node.needs || []).includes(n.id))
          .map((n) => contractsDirOf(state) + '/' + n.id + '__' + node.id + '.md')
        plan.push({
          stage: nodeId, dept: node.dept, title: node.title,
          model: dept.model, reasoning: dept.reasoning,
          prompt: '你是「' + (dept.title || node.dept) + '」，执行环节「' + (node.title || node.id) + '」（任务 ' + state.taskId + '）。只读注入：部门档案、交接契约切片 ' + contractSlices.join('、') + '。完成后用 company_record_evidence/company_verdict 等既有工具回报。',
          contractSlices,
        })
        done.add(nodeId)
        changed = true
      }
      if (!changed) return { ok: true, plan: [], note: '本 Sprint 全部环节已就绪完毕或已完成' }
      appendEvent(eventsFileFor(state), { type: 'sprint.plan', taskId: state.taskId, stages: plan.map((p) => p.stage) })
      return { ok: true, plan, note: '按顺序派工；可并行的环节用 run_in_background 同时派，遵守并发上限（复杂/高风险 2，其他 3）。' }
    })

    tool('company_hire_department', '招聘新部门：创建 company-dept-<id> preset 并注册进角色库。id=[a-z0-9-]{2,32}；model=deepseek-v4-pro|deepseek-v4-flash；reasoning=low|medium|high；tools 可选 bash/fs/search/jobs/subagent/web/ask/todo。新部门无 company_* 引擎工具（护栏）。', {
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

    // 裁决（瞬时 max）：v1 采用降级路径——发事件 + 返回裁决指引，由 Coordinator
    // 在下一回合用 subagent 工具以 max reasoning 执行裁决，结果经 company_decide 写回。
    // host 直派需要 live parent Agent（subagents.start 契约），作为 P3 增强项。
    async function adjudicate(state, question, options) {
      appendEvent(eventsFileFor(state), { type: 'adjudication.started', taskId: state.taskId, question })
      return {
        ok: true,
        mode: 'delegated',
        guidance: '请在下一回合用 subagent 工具派一个裁决子代理（model=deepseek-v4-pro，reasoning=max，角色=coordinator），问题：' + question + '；候选方案：' + JSON.stringify(options) + '；只输出一个方案 id 与一句话依据。裁决后用 company_decide 写回。',
        question, options,
      }
    }
  },
}
