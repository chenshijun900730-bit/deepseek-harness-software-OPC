// Software Company Harness — 浏览器面板（零依赖 ES 模块，随 preset 加载）
(function () {
  'use strict'
  function installPanel() {
  if (window.__COMPANY_PANEL_INSTALLED__) return
  // DOM 级防重兜底：不同 client bundle 沙箱可能互不可见 window 标志，
  // 但共享同一个 document —— 已装过则不再装（避免双 pill 重叠）
  if (document.getElementById('company-panel-root')) return
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
  // 优先用 host 从子代理首条提示中提取的角色名；否则从标题提取，失败则截断
  function roleLabel(c) {
    if (c.role && c.role.length > 0 && c.role.length <= 40) return c.role
    const t = (c.title || '').trim()
    const m = t.match(/的\s*([^（(。]+?)\s*[（(]/)
    if (m && m[1] && m[1].trim().length > 0 && m[1].trim().length <= 40) return m[1].trim()
    if (t.length > 40) return t.slice(0, 40) + '…'
    if (t) return t
    return String(c.id || '').slice(0, 8)
  }

  // ---------- 面板骨架 ----------
  const root = el('div', { position: 'fixed', top: '12px', right: '12px', zIndex: '100000', pointerEvents: 'auto', fontFamily: FONT, fontSize: '13px', color: '#e5e7eb' })
  root.id = 'company-panel-root'
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
  let canvasOpen = true
  let refreshSig = ''
  // 会话级隔离：每个对话框一个 Company
  let scope = null
  let scopeChosen = false
  let sessions = []

  const pill = el('button', { pointerEvents: 'auto', cursor: 'pointer', background: '#111827', color: '#e5e7eb', border: '1px solid #374151', borderRadius: '22px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', boxShadow: '0 4px 16px rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', gap: '6px' }, '\u{1F3E2} Company')
  pill.addEventListener('click', function () { open = true; render() })

  // 默认即最大：贴近视口的宽高，四边 + 右下角可拖拽缩放
  function maxPanelSize() {
    const vw = window.innerWidth || 1600
    const vh = window.innerHeight || 1000
    return { w: Math.max(520, Math.min(1320, vw - 320)), h: Math.max(420, Math.min(920, vh - 90)) }
  }
  const initial = maxPanelSize()
  const panelSize = { w: initial.w, h: initial.h }
  const panel = el('div', { width: panelSize.w + 'px', height: panelSize.h + 'px', maxHeight: 'none', display: 'flex', flexDirection: 'column', background: '#111827', border: '1px solid #374151', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,.5)', overflow: 'hidden', position: 'relative' })
  const header = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #1f2937' })
  const title = el('span', { fontWeight: '700', fontSize: '15px' }, '\u{1F3E2} Software Company')
  const headerBtns = el('div', { display: 'flex', gap: '6px' })
  const scopeSel = el('select', { pointerEvents: 'auto', cursor: 'pointer', background: '#111827', color: '#e5e7eb', border: '1px solid #374151', borderRadius: '6px', padding: '5px 8px', fontSize: '12px', fontWeight: '600', maxWidth: '240px' })
  scopeSel.title = '会话范围'
  scopeSel.addEventListener('change', function () { applyScope(scopeSel.value || null, false) })
  const refreshBtn = el('button', btnStyle('#94a3b8'), '\u21BB')
  const canvasBtn = el('button', btnStyle(canvasOpen ? '#f59e0b' : '#94a3b8'), '\u{1F5FA} \u753B\u5E03')
  canvasBtn.addEventListener('click', function () { canvasOpen = !canvasOpen; render() })
  const closeBtn = el('button', btnStyle('#94a3b8'), '\u2715')
  refreshBtn.addEventListener('click', function () { refreshAll() })
  closeBtn.addEventListener('click', function () { open = false; render() })
  headerBtns.appendChild(scopeSel); headerBtns.appendChild(refreshBtn); headerBtns.appendChild(canvasBtn); headerBtns.appendChild(closeBtn)
  header.appendChild(title); header.appendChild(headerBtns)

  // 画布区（任务选项卡上方）：iframe 复用 /company 页；收起时卸载停轮询，展开时重新挂载
  const canvasWrap = el('div', { display: 'none', flex: 'none', borderBottom: '1px solid #1f2937', background: '#0b0f19' })
  const canvasBar = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', fontSize: '11px', color: '#9ca3af', background: '#111827' }, [
    el('span', null, '\u{1F5FA} 总监大画布 · 实时（拖动节点 / 悬停信息卡 / 画布上审批决策）'),
    el('span', { cursor: 'pointer', color: '#f59e0b', fontWeight: '600' }, '\u6536\u8D77 \u25B2'),
  ])
  canvasBar.children[1].addEventListener('click', function () { canvasOpen = false; render() })
  const canvasFrame = document.createElement('iframe')
  canvasFrame.setAttribute('title', '总监大画布')
  canvasFrame.style.cssText = 'width:calc(100% - 8px);height:620px;border:0;display:block;background:#0b0f19;margin:0 4px'
  // 画布加载完成后同步当前 scope（避免画布首次打开短暂停留在「全部」）
  canvasFrame.addEventListener('load', function () { notifyCanvas(!scopeChosen) })
  canvasWrap.appendChild(canvasBar)
  canvasWrap.appendChild(canvasFrame)
  function mountCanvas(mount) {
    if (mount) {
      canvasWrap.style.display = 'block'
      canvasFrame.style.pointerEvents = 'auto' // 兜底：任何异常路径下画布都可交互
      if (canvasFrame.getAttribute('src') !== '/company') canvasFrame.setAttribute('src', '/company')
      syncCanvasHeight()
    } else {
      canvasWrap.style.display = 'none'
      if (canvasFrame.getAttribute('src') === '/company') canvasFrame.removeAttribute('src')
    }
  }
  function syncCanvasHeight() {
    canvasFrame.style.height = Math.max(420, (panelSize.h || 620) - 150) + 'px'
  }

  const tabs = el('div', { display: 'flex', gap: '4px', padding: '8px 10px 0' })
  const body = el('div', { padding: '10px', overflowY: 'auto', overflowX: 'hidden', flex: '1', minHeight: '60px' })
  const footer = el('div', { padding: '7px 12px', borderTop: '1px solid #1f2937', fontSize: '10px', color: '#6b7280', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, [
    el('span', null, '批准门禁 · 合同冻结 · 所有权互斥 · FAIL→全新 Repair Generator · 2修1重规划后暂停'),
    el('span', { fontSize: '10px', color: '#4b5563' }, '拖任意边界调整大小'),
  ])
  panel.appendChild(header); panel.appendChild(tabs); panel.appendChild(body); panel.appendChild(footer)

  // ---------- 面板尺寸：四边 + 右下角拖拽缩放 ----------
  function applySize() {
    panel.style.width = panelSize.w + 'px'
    panel.style.height = panelSize.h + 'px'
    panel.style.maxHeight = 'none'
    syncCanvasHeight()
  }
  function clampSize(w, h) {
    const vw = window.innerWidth || 1600
    const vh = window.innerHeight || 1000
    return { w: Math.max(420, Math.min(vw - 40, w)), h: Math.max(240, Math.min(vh - 40, h)) }
  }
  let panelTop = 12
  function startResize(e, mode) {
    e.preventDefault()
    const h = e.currentTarget
    try { h.setPointerCapture(e.pointerId) } catch (err) {}
    // 拖拽期间 iframe 对鼠标事件穿透：否则拖进画布区域后 mousemove 会被 iframe 文档吞掉
    canvasFrame.style.pointerEvents = 'none'
    const x0 = e.clientX, y0 = e.clientY, w0 = panelSize.w, h0 = panelSize.h, t0 = panelTop
    function onMove(ev) {
      const dx = ev.clientX - x0, dy = ev.clientY - y0
      let w = w0, h = h0
      if (mode === 'e' || mode === 'se') w = w0 + dx
      if (mode === 'w') w = w0 - dx
      if (mode === 's' || mode === 'se') h = h0 + dy
      if (mode === 'n') {
        // 顶边拖拽：顶边随光标移动，底边保持不动（上移不越过视口顶）
        panelTop = Math.max(12, Math.min(t0 + dy, t0 + h0 - 240))
        h = h0 - (panelTop - t0)
        root.style.top = panelTop + 'px'
      }
      const c = clampSize(w, h)
      panelSize.w = c.w; panelSize.h = c.h
      applySize()
    }
    function onUp(e) {
      canvasFrame.style.pointerEvents = 'auto'
      try { if (e && e.pointerId !== undefined && h.releasePointerCapture) h.releasePointerCapture(e.pointerId) } catch (err) {}
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  function edgeHandle(cursor, mode) {
    const h = el('div', { position: 'absolute', zIndex: '12', background: 'transparent' })
    h.style.cursor = cursor
    h.addEventListener('pointerdown', function (e) { startResize(e, mode) })
    return h
  }
  const edgeLeft = edgeHandle('ew-resize', 'w')
  const edgeRight = edgeHandle('ew-resize', 'e')
  const edgeTop = edgeHandle('ns-resize', 'n')
  const edgeBottom = edgeHandle('ns-resize', 's')
  Object.assign(edgeLeft.style, { left: '-4px', top: '30px', bottom: '8px', width: '8px' })
  Object.assign(edgeRight.style, { right: '-4px', top: '30px', bottom: '8px', width: '8px' })
  Object.assign(edgeTop.style, { top: '-4px', left: '8px', right: '8px', height: '8px' })
  Object.assign(edgeBottom.style, { bottom: '-4px', left: '8px', right: '8px', height: '8px' })
  panel.appendChild(edgeLeft); panel.appendChild(edgeRight); panel.appendChild(edgeTop); panel.appendChild(edgeBottom)

  const grip = el('div', { position: 'absolute', right: '-6px', bottom: '-6px', width: '26px', height: '26px', cursor: 'nwse-resize', zIndex: '12' })
  const gripSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  gripSvg.setAttribute('width', '14'); gripSvg.setAttribute('height', '14'); gripSvg.setAttribute('viewBox', '0 0 14 14')
  gripSvg.style.position = 'absolute'; gripSvg.style.right = '3px'; gripSvg.style.bottom = '3px'; gripSvg.style.pointerEvents = 'none'
  const gripPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  gripPath.setAttribute('d', 'M13 13 L4 13 M13 13 L13 4 M9 13 L13 9')
  gripPath.setAttribute('stroke', '#4b5563'); gripPath.setAttribute('stroke-width', '1.5'); gripPath.setAttribute('fill', 'none')
  gripSvg.appendChild(gripPath)
  grip.appendChild(gripSvg)
  grip.addEventListener('pointerdown', function (e) { startResize(e, 'se') })
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
    let sig = ''
    try { const url = '/company-api/dashboard' + (scope ? '?scope=' + encodeURIComponent(scope) : ''); const d = await getJSON(url); tasks = d.tasks || []; sig += 'T' + JSON.stringify(tasks) } catch (e) { tasks = []; sig += 'T[]' }
    try { tokenData = await getJSON('/company-api/tokens'); sig += 'K' + (tokenData && tokenData.rows ? tokenData.rows.length : 0) } catch (e) { tokenData = null; sig += 'K0' }
    try { const a = await getJSON('/company-api/agents'); agentEntries = (a.entries || []).slice().reverse(); agentTotal = a.total || agentEntries.length; sig += 'A' + agentTotal + ':' + agentEntries.length } catch (e) { agentEntries = []; agentTotal = 0; sig += 'A0' }
    // 数据无变化不重绘（消除 4s 轮询整块重建造成的闪动）
    if (sig !== refreshSig) { refreshSig = sig; render() }
    // 会话清单 + 自动识别当前对话框
    try { const sl = await getJSON('/company-api/sessions'); if (Array.isArray(sl)) { sessions = sl; autoScope(); renderScopeOptions() } } catch (e) {}
  }
  // ---------- 会话级隔离：侧栏点击切换 → 面板/画布自动跟随 ----------
  // 手动选择 scope（下拉/画布 chip）在下次侧栏切换前保持锁定；侧栏选中行变化
  // 一律解除锁定并跟随新会话（用户核心诉求：点击不同会话自动切换）。
  let lastParentTitle = null
  function selectedSessionTitle() {
    try {
      const sel = document.querySelector('.pqeL5W_sessionRow.pqeL5W_selected .pqeL5W_title')
      if (sel && sel.textContent) return sel.textContent.trim()
    } catch (e) {}
    return null
  }
  function notifyCanvas(auto) {
    try {
      if (canvasFrame && canvasFrame.contentWindow) {
        canvasFrame.contentWindow.postMessage({ type: 'company-scope', sessionId: scope, auto: !!auto }, window.location.origin)
      }
    } catch (e) {}
  }
  function applyScope(next, auto) {
    scope = next
    scopeChosen = !auto
    refreshSig = ''
    notifyCanvas(auto)
    refreshAll()
    renderScopeOptions()
  }
  function autoScope() {
    const title = selectedSessionTitle()
    if (!title) return
    if (title !== lastParentTitle) { lastParentTitle = title; scopeChosen = false } // 侧栏切换 → 恢复自动跟随
    if (scopeChosen) return
    for (const s of sessions) {
      if (s.title === title && scope !== s.sessionId) { applyScope(s.sessionId, true); return }
    }
  }
  // 侧栏选中态变化即时触发（不依赖 4s 轮询）：监听 class/aria-selected 变更与
  // 会话树节点插入（首屏渲染时选中态随节点一起插入，没有属性变更事件）。
  function watchSessionSelection() {
    let obs = null
    function start() {
      if (typeof MutationObserver === 'undefined') return
      if (obs) { try { obs.disconnect() } catch (e) {} }
      obs = new MutationObserver(function () { autoScope() })
      obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected'] })
    }
    if (document.body) start()
    else document.addEventListener('DOMContentLoaded', start)
  }
  watchSessionSelection()
  function renderScopeOptions() {
    if (!scopeSel) return
    const val = scope || ''
    let html = '<option value="">🏢 全部</option>'
    sessions.forEach(function (s) { html += '<option value="' + (s.sessionId || '') + '"' + (val === s.sessionId ? ' selected' : '') + '>📂 ' + (s.title || String(s.sessionId || '').slice(0, 8)) + ' · ' + s.taskCount + '</option>' })
    scopeSel.innerHTML = html
  }
  async function act(taskId, action) {
    try { await getJSON('/company-api/action?taskId=' + encodeURIComponent(taskId) + '&action=' + encodeURIComponent(action)) } catch (e) {}
    confirmAction = null
    await refreshAll()
  }

  // ---------- 渲染 ----------
  function render() {
    root.innerHTML = ''
    if (!open) { root.appendChild(pill); return }
    tabs.innerHTML = ''
    tabs.appendChild(tabBtn('tasks', '\u{1F5D3} 任务'))
    tabs.appendChild(tabBtn('tokens', '\u26A1 Tokens'))
    tabs.appendChild(tabBtn('agents', '\u{1F9EC} 子代理'))
    body.innerHTML = ''
    if (tab === 'tasks') renderTasks()
    else if (tab === 'tokens') renderTokens()
    else renderAgents()
    // 画布区固定在 header 之下、选项卡之上；收起时卸载 iframe 停掉 2s 轮询
    if (canvasWrap.parentNode !== panel) panel.insertBefore(canvasWrap, tabs)
    mountCanvas(canvasOpen)
    canvasBtn.style.borderColor = canvasOpen ? '#f59e0b' : '#94a3b8'
    canvasBtn.style.color = canvasOpen ? '#f59e0b' : '#94a3b8'
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
      body.appendChild(el('div', { fontSize: '11px', color: '#9ca3af', margin: '4px 0' }, '子代理会话（分层）· 共 ' + children.length + ' 个'))
      const maxT = Math.max.apply(null, children.map(function (r) { return r.totalTokens || 0 }).concat([1]))
      for (const c of children) {
        const name = roleLabel(c)
        const full = (c.title || '') + ' [' + (c.id || '') + ']'
        const card = el('div', { padding: '7px 8px', marginBottom: '6px', background: '#0b0f19', border: '1px solid #1f2937', borderRadius: '8px' })
        const line1 = el('div', { display: 'flex', alignItems: 'center', gap: '8px' })
        const nameSpan = el('span', { flex: '1', minWidth: '0', fontSize: '12px', fontWeight: '600', color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, name)
        nameSpan.title = full
        line1.appendChild(nameSpan)
        line1.appendChild(el('span', { flex: 'none', fontSize: '10px', color: '#7dd3fc', padding: '2px 8px', borderRadius: '8px', background: '#0e2a43', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, c.model ? c.model + (c.modelProvider ? '（' + c.modelProvider + '）' : '') : '模型待定'))
        card.appendChild(line1)
        const line2 = el('div', { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px' })
        line2.appendChild(bar('#8b5cf6', (c.totalTokens || 0) / maxT, 6))
        const usage = c.baseline && c.baseline.kind === 'usage'
          ? '输入 ' + fmt(c.baseline.inputTokens) + ' · 输出 ' + fmt(c.baseline.outputTokens) + ' · 合计 ' + fmt(c.totalTokens)
          : '合计 ' + fmt(c.totalTokens) + '（用量不可获得）'
        line2.appendChild(el('span', { flex: 'none', fontSize: '10px', color: '#9ca3af', whiteSpace: 'nowrap' }, usage))
        card.appendChild(line2)
        body.appendChild(card)
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
  setInterval(function () { if (open) refreshAll() }, 2000)
  }

  window.__ModuleLoader__.load({
    id: '/Users/xiaowanzi/.dsh/.agent-presets/software-company/packages/company-panel',
    factory: function () {
      var plugin = { apply: function () { installPanel() } }
      return { apply: plugin.apply, default: plugin }
    },
  })
})()
