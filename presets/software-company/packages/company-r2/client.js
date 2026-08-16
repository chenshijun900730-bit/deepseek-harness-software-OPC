// Software Company Harness — 浏览器面板（零依赖 ES 模块，随 preset 加载）
(function () {
  'use strict'
  function installPanel() {
  if (window.__COMPANY_PANEL_INSTALLED__) return
  window.__COMPANY_PANEL_INSTALLED__ = true

  const STAGES = ['INTAKE', 'CLASSIFIED', 'DISCOVERY', 'PRODUCT_PLANNED', 'WAITING_INITIAL_APPROVAL', 'SPRINT_DRAFTING', 'CONTRACT_REVIEW', 'CONTRACT_SIGNED', 'IMPLEMENTING', 'SELF_CHECK', 'INTEGRATING', 'QA_RUNNING', 'SPRINT_PASSED', 'REPAIRING', 'REPLANNING', 'FINAL_E2E', 'RELEASED']
  const STATUS_COLOR = {
    WAITING_INITIAL_APPROVAL: '#f59e0b', PAUSED: '#ef4444', TERMINATED: '#6b7280', RELEASED: '#22c55e',
    REPAIRING: '#ef4444', REPLANNING: '#ef4444', QA_RUNNING: '#3b82f6', FINAL_E2E: '#3b82f6',
    IMPLEMENTING: '#8b5cf6', SPRINT_PASSED: '#22c55e', CONTRACT_SIGNED: '#8b5cf6',
  }
  const TYPE_LABEL = { small: '小型', medium: '中型', complex: '复杂', 'high-risk': '高风险' }
  const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"

  function el(tag, style, children) {
    const node = document.createElement(tag)
    if (style) Object.assign(node.style, style)
    if (children !== undefined) {
      const list = Array.isArray(children) ? children : [children]
      for (const c of list) {
        if (c === null || c === undefined) continue
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
      }
    }
    return node
  }
  function fmt(n) {
    if (n === undefined || n === null) return '-'
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
    return String(n)
  }
  function nowLabel() {
    const d = new Date()
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0')
  }

  // ---------- 面板骨架 ----------
  const root = el('div', { position: 'fixed', top: '12px', right: '12px', zIndex: '100000', pointerEvents: 'auto', fontFamily: FONT, fontSize: '13px', color: '#e5e7eb' })
  document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(root) })
  if (document.body) document.body.appendChild(root)

  let open = false
  let tab = 'tasks'
  let tasks = []
  let tokenData = null
  let agentEntries = []
  let agentTotal = 0
  let detail = null
  let confirmAction = null

  const pill = el('button', { pointerEvents: 'auto', cursor: 'pointer', background: '#111827', color: '#e5e7eb', border: '1px solid #374151', borderRadius: '22px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', boxShadow: '0 4px 16px rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', gap: '6px' }, '\u{1F3E2} Company')
  pill.addEventListener('click', function () { open = true; render() })

  const canvasLink = el('a', { pointerEvents: 'auto', cursor: 'pointer', background: '#f59e0b', color: '#0b0f19', border: '1px solid #f59e0b', borderRadius: '22px', padding: '10px 14px', fontSize: '13px', fontWeight: '700', textDecoration: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.35)' }, '\u{1F5FA} 总监大画布')
  canvasLink.setAttribute('href', '/company')
  canvasLink.setAttribute('target', '_blank')

  const panelSize = { w: 640, h: null }
  const panel = el('div', { width: panelSize.w + 'px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: '#111827', border: '1px solid #374151', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,.5)', overflow: 'hidden', position: 'relative' })
  const header = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #1f2937' })
  const title = el('span', { fontWeight: '700', fontSize: '15px' }, '\u{1F3E2} Software Company')
  const headerBtns = el('div', { display: 'flex', gap: '6px' })
  const presetW = function (label, w) {
    const b = el('button', btnStyle(panelSize.w === w && panelSize.h === null ? '#f59e0b' : '#64748b'), label)
    b.addEventListener('click', function () { panelSize.w = w; panelSize.h = null; applySize(); render() })
    return b
  }
  headerBtns.appendChild(presetW('窄', 380)); headerBtns.appendChild(presetW('中', 520)); headerBtns.appendChild(presetW('宽', 700))
  const refreshBtn = el('button', btnStyle('#94a3b8'), '\u21BB')
  const closeBtn = el('button', btnStyle('#94a3b8'), '\u2715')
  refreshBtn.addEventListener('click', function () { refreshAll() })
  closeBtn.addEventListener('click', function () { open = false; render() })
  headerBtns.appendChild(refreshBtn); headerBtns.appendChild(closeBtn)
  header.appendChild(title); header.appendChild(headerBtns)

  const tabs = el('div', { display: 'flex', gap: '4px', padding: '8px 10px 0' })
  const body = el('div', { padding: '10px', overflowY: 'auto', overflowX: 'hidden', flex: '1', minHeight: '60px' })
  const footer = el('div', { padding: '7px 12px', borderTop: '1px solid #1f2937', fontSize: '10px', color: '#6b7280', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, [
    el('span', null, '批准门禁 · 合同冻结 · 所有权互斥 · FAIL→全新 Repair Generator · 2修1重规划后暂停'),
    el('span', { fontSize: '10px', color: '#4b5563' }, '拖右下角可调大小'),
  ])
  panel.appendChild(header); panel.appendChild(tabs); panel.appendChild(body); panel.appendChild(footer)

  // ---------- 面板尺寸 ----------
  function applySize() {
    panel.style.width = panelSize.w + 'px'
    if (panelSize.h !== null) { panel.style.height = panelSize.h + 'px'; panel.style.maxHeight = 'none' }
    else { panel.style.height = ''; panel.style.maxHeight = '85vh' }
  }
  const grip = el('div', { position: 'absolute', right: '0', bottom: '0', width: '22px', height: '22px', cursor: 'nwse-resize', zIndex: '10' })
  const gripSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  gripSvg.setAttribute('width', '14'); gripSvg.setAttribute('height', '14'); gripSvg.setAttribute('viewBox', '0 0 14 14')
  gripSvg.style.position = 'absolute'; gripSvg.style.right = '3px'; gripSvg.style.bottom = '3px'; gripSvg.style.pointerEvents = 'none'
  const gripPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  gripPath.setAttribute('d', 'M13 13 L4 13 M13 13 L13 4 M9 13 L13 9')
  gripPath.setAttribute('stroke', '#4b5563'); gripPath.setAttribute('stroke-width', '1.5'); gripPath.setAttribute('fill', 'none')
  gripSvg.appendChild(gripPath)
  grip.appendChild(gripSvg)
  grip.addEventListener('mousedown', function (e) {
    e.preventDefault()
    const x0 = e.clientX, y0 = e.clientY, w0 = panelSize.w, h0 = panelSize.h === null ? 520 : panelSize.h
    function onMove(ev) {
      panelSize.w = Math.max(340, Math.min(820, w0 + (ev.clientX - x0)))
      panelSize.h = Math.max(260, Math.min(860, h0 + (y0 - ev.clientY)))
      applySize()
    }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })
  panel.appendChild(grip)
  applySize()

  function btnStyle(color) {
    return { pointerEvents: 'auto', cursor: 'pointer', background: 'transparent', color, border: '1px solid ' + color, borderRadius: '6px', padding: '5px 10px', fontSize: '12px', fontWeight: '600' }
  }
  function tabBtn(id, label) {
    const b = el('button', btnStyle(tab === id ? '#f59e0b' : '#64748b'), label)
    b.addEventListener('click', function () { tab = id; detail = null; confirmAction = null; render() })
    return b
  }

  // ---------- 数据轮询 ----------
  async function getJSON(path) {
    const r = await fetch(path, { cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    return await r.json()
  }
  async function refreshAll() {
    try { const d = await getJSON('/company-api/dashboard'); tasks = d.tasks || [] } catch (e) { tasks = [] }
    try { tokenData = await getJSON('/company-api/tokens') } catch (e) { tokenData = null }
    try { const a = await getJSON('/company-api/agents'); agentEntries = (a.entries || []).slice().reverse(); agentTotal = a.total || agentEntries.length } catch (e) { agentEntries = []; agentTotal = 0 }
    render()
  }
  async function act(taskId, action) {
    try { await getJSON('/company-api/action?taskId=' + encodeURIComponent(taskId) + '&action=' + encodeURIComponent(action)) } catch (e) {}
    confirmAction = null
    await refreshAll()
  }

  // ---------- 渲染 ----------
  function render() {
    root.innerHTML = ''
    if (!open) {
      const wrap = el('div', { display: 'flex', gap: '8px', alignItems: 'center' })
      wrap.appendChild(pill)
      wrap.appendChild(canvasLink)
      root.appendChild(wrap)
      return
    }
    tabs.innerHTML = ''
    tabs.appendChild(tabBtn('tasks', '\u{1F5D3} 任务'))
    tabs.appendChild(tabBtn('tokens', '\u26A1 Tokens'))
    tabs.appendChild(tabBtn('agents', '\u{1F9EC} 子代理'))
    body.innerHTML = ''
    if (tab === 'tasks') renderTasks()
    else if (tab === 'tokens') renderTokens()
    else renderAgents()
    root.appendChild(panel)
  }

  function bar(color, ratio, height) {
    const wrap = el('div', { flex: '1', background: '#1f2937', borderRadius: '4px', height: (height || 6) + 'px', overflow: 'hidden' })
    wrap.appendChild(el('div', { width: Math.max(2, Math.round(ratio * 100)) + '%', height: '100%', background: color, borderRadius: '4px' }))
    return wrap
  }

  function renderTasks() {
    if (tasks.length === 0) {
      body.appendChild(el('div', { color: '#9ca3af', fontSize: '12px' }, '暂无任务。对话中用 company_start 启动（如「公司模式：帮我做一个待办应用」）。'))
      return
    }
    for (const t of tasks) {
      const color = STATUS_COLOR[t.status] || '#64748b'
      const stageIdx = STAGES.indexOf(t.status)
      const card = el('div', { border: '1px solid #1f2937', borderRadius: '10px', padding: '10px', marginBottom: '8px', background: '#0b0f19', cursor: 'pointer' })
      const head = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' })
      head.appendChild(el('span', { fontWeight: '600', fontSize: '14px' }, t.taskId))
      head.appendChild(el('span', { fontSize: '11px', padding: '3px 10px', borderRadius: '10px', background: color, color: '#0b0f19', fontWeight: '700' }, t.status))
      card.appendChild(head)
      card.appendChild(el('div', { marginTop: '4px', fontSize: '12px', color: '#9ca3af' },
        (TYPE_LABEL[t.type] || t.type) + ' · ' + t.mode + ' · Sprint ' + (t.currentSprint || '-') + ' · 修复 ' + t.repairs + ' · ' + t.sprintsDone + '/' + t.sprintTotal + ' Sprint'))
      if (stageIdx >= 0) {
        const pg = el('div', { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' })
        pg.appendChild(el('span', { fontSize: '10px', color: '#6b7280', width: '64px', flex: 'none' }, '流程 ' + stageIdx + '/' + (STAGES.length - 1)))
        pg.appendChild(bar(color, stageIdx / (STAGES.length - 1), 6))
        card.appendChild(pg)
      }
      if (t.sprintTotal > 0) {
        const sp2 = el('div', { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' })
        sp2.appendChild(el('span', { fontSize: '10px', color: '#6b7280', width: '64px', flex: 'none' }, 'Sprint ' + t.sprintsDone + '/' + t.sprintTotal))
        sp2.appendChild(bar('#22c55e', t.sprintTotal > 0 ? t.sprintsDone / t.sprintTotal : 0, 6))
        card.appendChild(sp2)
      }
      const isDetail = detail && detail.taskId === t.taskId
      if (isDetail && detail.history) {
        const box = el('div', { marginTop: '6px', fontSize: '11px', color: '#cbd5e1', borderTop: '1px solid #1f2937', paddingTop: '6px' })
        if (detail.nextSteps && detail.nextSteps.length) {
          for (const s of detail.nextSteps) box.appendChild(el('div', { marginBottom: '2px' }, '\u2192 ' + s))
        }
        box.appendChild(el('div', { marginTop: '6px', color: '#6b7280', fontSize: '10px' }, '最近状态变化：'))
        for (const h of detail.history.slice().reverse().slice(0, 6)) {
          box.appendChild(el('div', { marginBottom: '2px' }, h.from + ' \u2192 ' + h.to + '  ' + h.reason))
        }
        card.appendChild(box)
      }
      const actions = el('div', { marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' })
      const mk = function (label, color, action, confirm) {
        const b = el('button', btnStyle(color), label)
        b.addEventListener('click', function (e) {
          e.stopPropagation()
          if (confirm && confirmAction !== t.taskId) { confirmAction = t.taskId; render(); return }
          act(t.taskId, action)
        })
        return b
      }
      if (t.status === 'WAITING_INITIAL_APPROVAL') actions.appendChild(mk('\u2705 批准', '#f59e0b', 'approve', false))
      if (t.status === 'PAUSED') actions.appendChild(mk('\u25B6 恢复', '#22c55e', 'resume', false))
      else if (['RELEASED', 'TERMINATED'].indexOf(t.status) < 0) actions.appendChild(mk('\u23F8 暂停', '#3b82f6', 'pause', false))
      if (['RELEASED', 'TERMINATED'].indexOf(t.status) < 0) actions.appendChild(mk(confirmAction === t.taskId ? '\u26A0 确认终止?' : '\u23F9 终止', '#ef4444', 'terminate', true))
      if (actions.children.length) card.appendChild(actions)
      card.addEventListener('click', function () {
        if (detail && detail.taskId === t.taskId) { detail = null; render(); return }
        getJSON('/company-api/task?taskId=' + encodeURIComponent(t.taskId)).then(function (d) { detail = d; render() }).catch(function () {})
      })
      body.appendChild(card)
    }
  }

  function renderTokens() {
    if (!tokenData || !tokenData.rows || tokenData.rows.length === 0) {
      body.appendChild(el('div', { color: '#9ca3af', fontSize: '12px' }, '暂无 Token 数据（采样中…）'))
      return
    }
    const root = tokenData.rows.filter(function (r) { return r.isRoot })[0] || tokenData.rows[0]
    if (root && !root.error) {
      const card = el('div', { border: '1px solid #1f2937', borderRadius: '10px', padding: '10px', marginBottom: '8px', background: '#0b0f19' })
      const label = root.title || (root.isRoot ? '主会话' : '会话')
      const headLine = el('div', { fontWeight: '600', marginBottom: '6px' })
      headLine.appendChild(document.createTextNode('\u26A1 ' + label + '（实时 Token）'))
      if (root.model) headLine.appendChild(el('span', { color: '#7dd3fc' }, ' · ' + root.model + (root.modelProvider ? '（' + root.modelProvider + '）' : '')))
      card.appendChild(headLine)
      const big = el('div', { display: 'flex', alignItems: 'baseline', gap: '8px' })
      big.appendChild(el('span', { fontSize: '26px', fontWeight: '800', color: '#f59e0b' }, fmt(root.totalTokens)))
      big.appendChild(el('span', { fontSize: '11px', color: '#9ca3af' }, '总 Token（请求+响应估算）'))
      card.appendChild(big)
      if (root.baseline && root.baseline.kind === 'usage') {
        const split = el('div', { display: 'flex', gap: '8px', marginTop: '6px' })
        const total = root.baseline.tokens || 1
        split.appendChild(el('div', { flex: '1' }, [
          el('div', { fontSize: '10px', color: '#9ca3af' }, '输入 ' + fmt(root.baseline.inputTokens)),
          bar('#3b82f6', root.baseline.inputTokens / total, 6),
        ]))
        split.appendChild(el('div', { flex: '1' }, [
          el('div', { fontSize: '10px', color: '#9ca3af' }, '输出 ' + fmt(root.baseline.outputTokens)),
          bar('#22c55e', root.baseline.outputTokens / total, 6),
        ]))
        card.appendChild(split)
      }
      card.appendChild(el('div', { fontSize: '10px', color: '#6b7280', marginTop: '6px' }, '上下文表面 ' + fmt(root.surfaceTokens) + ' tokens · 增量 ' + fmt(root.surfaceDeltaTokens)))
      if (tokenData.history && tokenData.history.length >= 2) {
        card.appendChild(sparkline(tokenData.history))
      }
      body.appendChild(card)
    }
    const children = tokenData.rows.filter(function (r) { return !r.isRoot })
    if (children.length) {
      body.appendChild(el('div', { fontSize: '11px', color: '#9ca3af', margin: '4px 0' }, '子代理会话（分层）'))
      const maxT = Math.max.apply(null, children.map(function (r) { return r.totalTokens || 0 }).concat([1]))
      for (const c of children) {
        const row = el('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid #1f2937' })
        row.appendChild(el('span', { width: '130px', flex: 'none', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, (c.title || c.id || '?').slice(0, 24)))
        row.appendChild(el('span', { flex: 'none', fontSize: '10px', color: '#7dd3fc', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, c.model ? c.model + (c.modelProvider ? '（' + c.modelProvider + '）' : '') : '模型待定'))
        row.appendChild(bar('#8b5cf6', (c.totalTokens || 0) / maxT, 6))
        row.appendChild(el('span', { width: '70px', flex: 'none', fontSize: '11px', textAlign: 'right', color: '#cbd5e1' }, fmt(c.totalTokens)))
        body.appendChild(row)
      }
    }
  }

  function sparkline(history) {
    const box = el('div', { marginTop: '8px' })
    box.appendChild(el('div', { fontSize: '10px', color: '#9ca3af', marginBottom: '4px' }, 'Token 增长曲线（5s 采样 · 最近 ' + history.length + ' 点）'))
    const W = Math.max(260, panelSize.w - 84), H = 48
    const vals = history.map(function (h) { return h.total })
    const min = Math.min.apply(null, vals)
    const max = Math.max.apply(null, vals)
    const range = max - min || 1
    const pts = vals.map(function (v, i) {
      const x = (i / (vals.length - 1)) * (W - 4) + 2
      const y = H - 4 - ((v - min) / range) * (H - 8)
      return x.toFixed(1) + ',' + y.toFixed(1)
    }).join(' ')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H))
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
    poly.setAttribute('points', pts)
    poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', '#f59e0b'); poly.setAttribute('stroke-width', '1.5')
    svg.appendChild(poly)
    box.appendChild(svg)
    box.appendChild(el('div', { fontSize: '10px', color: '#6b7280' }, fmt(max) + ' 峰值 · ' + fmt(vals[vals.length - 1]) + ' 当前'))
    return box
  }

  function renderAgents() {
    if (agentEntries.length === 0) {
      body.appendChild(el('div', { color: '#9ca3af', fontSize: '12px' }, '暂无子代理调用记录（用 subagent/workflow 派工后这里实时出现，且持久累积）。'))
      return
    }
    body.appendChild(el('div', { fontSize: '11px', color: '#9ca3af', margin: '0 0 6px' }, '共 ' + agentTotal + ' 条（持久累积，跨重启保留；下方为最近 ' + agentEntries.length + ' 条）'))
    for (const e of agentEntries) {
      const isStart = e.kind === 'start'
      const color = isStart ? '#3b82f6' : (e.stopReason && String(e.stopReason).toLowerCase().indexOf('error') >= 0 ? '#ef4444' : '#22c55e')
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid #1f2937' })
      row.appendChild(el('span', { fontSize: '10px', width: '64px', flex: 'none', color: '#6b7280' }, (e.at || '').slice(11, 19)))
      row.appendChild(el('span', { fontSize: '10px', padding: '1px 6px', borderRadius: '8px', background: color, color: '#0b0f19', fontWeight: '700', width: '40px', textAlign: 'center', flex: 'none' }, isStart ? '启动' : '结束'))
      row.appendChild(el('span', { flex: 'none', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }, e.provider + ' · ' + String(e.id).slice(0, 8)))
      row.appendChild(el('span', { flex: '1', fontSize: '11px', color: '#7dd3fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, e.model ? e.model + (e.modelProvider ? '（' + e.modelProvider + '）' : '') : '模型待定'))
      if (!isStart && e.stopReason) row.appendChild(el('span', { fontSize: '10px', color: '#9ca3af', flex: 'none' }, String(e.stopReason).slice(0, 18)))
      body.appendChild(row)
    }
  }

  render()
  refreshAll()
  setInterval(function () { if (open) refreshAll() }, 4000)
  }

  window.__ModuleLoader__.load({
    id: '/Users/xiaowanzi/.dsh/.agent-presets/software-company/packages/company-r2',
    factory: function () {
      var plugin = { apply: function () { installPanel() } }
      return { apply: plugin.apply, default: plugin }
    },
  })
})()
