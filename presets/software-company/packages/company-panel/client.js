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
  function fmtFull(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
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

  // 主界面悬浮对话坞：紧贴聊天区右下（输入框上方），部门实时对话以聊天气泡呈现
  const dock = el('div', {
    position: 'fixed', right: '24px', bottom: '190px', width: '400px',
    maxWidth: 'calc(100vw - 32px)', maxHeight: '44vh', zIndex: '100001', pointerEvents: 'auto',
    fontFamily: FONT, fontSize: '12px', color: '#e5e7eb', background: '#111827',
    border: '1px solid #374151', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,.5)',
    overflow: 'hidden', flexDirection: 'column',
  })
  dock.id = 'company-live-dock'
  document.addEventListener('DOMContentLoaded', function () { if (!document.body.contains(dock)) document.body.appendChild(dock) })
  if (document.body) document.body.appendChild(dock)

  let open = false
  let tab = 'tasks'
  let tasks = []
  let tokenData = null
  let agentEntries = []
  let agentTotal = 0
  let detail = null
  let confirmAction = null
  let canvasOpen = false
  let refreshSig = ''
  // 会话级隔离：每个对话框一个 Company
  let scope = null
  let scopeChosen = false
  let sessions = []
  // 子部门实时思考/对话视图：transcript = { sid, label, model }
  let transcript = null
  let tcTimer = null
  let tcSeq = null
  // 部门实时对话（面板区 + 主界面悬浮对话坞）：liveFeeds[sid] = { d, at, dept, model, label, taskId }
  let liveFeeds = {}
  let liveTickAt = 0
  let dockDismissedUntil = 0
  let dockCollapsed = false
  let lastLiveSids = ''
  let roleTitles = {}
  let scopeHint = ''

  const pill = el('button', { pointerEvents: 'auto', cursor: 'pointer', background: '#111827', color: '#e5e7eb', border: '1px solid #374151', borderRadius: '22px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', boxShadow: '0 4px 16px rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', gap: '6px' }, '\u{1F3E2} Company')
  let pillMoved = false
  pill.addEventListener('pointerdown', function (e) {
    pillMoved = false
    const sx = e.clientX, sy = e.clientY
    const r = root.getBoundingClientRect()
    const dx = e.clientX - r.left, dy = e.clientY - r.top
    function onMove(ev) {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) pillMoved = true
      if (pillMoved) {
        root.style.right = 'auto'
        root.style.left = Math.round(ev.clientX - dx) + 'px'
        root.style.top = Math.round(ev.clientY - dy) + 'px'
      }
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  })
  pill.addEventListener('click', function () { if (pillMoved) return; open = true; render() })

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
  const canvasBtn = el('button', btnStyle(canvasOpen ? '#f59e0b' : '#94a3b8'), '\u{1F5FA} \u663E\u793A\u8BE6\u7EC6\u4FE1\u606F')
  canvasBtn.title = '总监大画布（详细信息）：以底部抽屉形式展开，列表在上、画布在下；收起后列表占满面板'
  canvasBtn.addEventListener('click', function () { canvasOpen = !canvasOpen; render() })
  const closeBtn = el('button', btnStyle('#94a3b8'), '\u2715')
  refreshBtn.addEventListener('click', function () { refreshAll() })
  closeBtn.addEventListener('click', function () {
    open = false
    root.style.top = '12px'; root.style.right = '12px'; root.style.left = 'auto'
    panelTop = 12
    render()
  })
  const popoutBtn = el('button', btnStyle('#7dd3fc'), '\u29C9 \u72EC\u7ACB\u7A97\u53E3')
  popoutBtn.title = '把总监大画布弹出为独立窗口（可随意拖动，不局限在浏览器内）'
  popoutBtn.addEventListener('click', function () {
    try {
      const w = window.open('/company' + (scope ? '?scope=' + encodeURIComponent(scope) : ''), 'company-canvas-popout', 'width=1520,height=880,popup=yes')
      if (w) w.focus()
    } catch (e) {}
  })
  let pipBtn = null
  let pipSupported = false
  if (window.documentPictureInPicture && window.documentPictureInPicture.requestWindow) {
    pipSupported = true
    pipBtn = el('button', btnStyle('#f59e0b'), '\uD83D\uDCCC \u60AC\u6D6E\u7F6E\u9876')
    pipBtn.title = '弹出为置顶悬浮窗（OS 窗口：可拖到任意屏幕，始终悬于其他应用之上）'
    pipBtn.addEventListener('click', function () {
      window.documentPictureInPicture.requestWindow({ width: 1520, height: 880 }).then(function (pip) {
        pip.location.href = '/company' + (scope ? '?scope=' + encodeURIComponent(scope) : '')
      }).catch(function () {})
    })
    headerBtns.appendChild(pipBtn)
  }
  // ================= 窗口按钮可选（⚙ 设置，localStorage 记住） =================
  let winPrefs = { popout: true, pip: true }
  try {
    const savedW = JSON.parse(localStorage.getItem('companyPanelWindows') || '{}')
    if (savedW && typeof savedW === 'object') winPrefs = Object.assign(winPrefs, savedW)
  } catch (e) {}
  function saveWinPrefs() { try { localStorage.setItem('companyPanelWindows', JSON.stringify(winPrefs)) } catch (e) {} }
  function applyWinPrefs() {
    if (popoutBtn) popoutBtn.style.display = winPrefs.popout ? '' : 'none'
    if (pipBtn) pipBtn.style.display = winPrefs.pip ? '' : 'none'
  }
  const gearBtn = el('button', btnStyle('#94a3b8'), '\u2699')
  gearBtn.title = '窗口按钮显示设置（可选显示/隐藏）'
  const gearMenu = el('div', { display: 'none', position: 'absolute', top: '34px', right: '0px', background: '#111827', border: '1px solid #374151', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', zIndex: '20', boxShadow: '0 8px 24px rgba(0,0,0,.5)', color: '#e5e7eb' })
  function renderGearMenu() {
    gearMenu.innerHTML = ''
    const items = [['popout', '⧉ 独立窗口按钮']]
    if (pipSupported) items.push(['pip', '📌 悬浮置顶按钮'])
    items.forEach(function (it) {
      const label = el('label', { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', cursor: 'pointer' })
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = !!winPrefs[it[0]]
      cb.addEventListener('change', function () { winPrefs[it[0]] = cb.checked; saveWinPrefs(); applyWinPrefs() })
      label.appendChild(cb)
      label.appendChild(document.createTextNode(it[1]))
      gearMenu.appendChild(label)
    })
  }
  gearBtn.addEventListener('click', function (e) {
    e.stopPropagation()
    renderGearMenu()
    gearMenu.style.display = gearMenu.style.display === 'none' ? 'block' : 'none'
  })
  document.addEventListener('pointerdown', function (e) {
    if (gearMenu.style.display === 'block' && !gearMenu.contains(e.target)) gearMenu.style.display = 'none'
  })
  headerBtns.style.position = 'relative'
  headerBtns.appendChild(gearBtn)
  headerBtns.appendChild(gearMenu)
  applyWinPrefs()
  headerBtns.appendChild(scopeSel); headerBtns.appendChild(popoutBtn); headerBtns.appendChild(refreshBtn); headerBtns.appendChild(canvasBtn); headerBtns.appendChild(closeBtn)
  header.appendChild(title); header.appendChild(headerBtns)

  // ================= 面板整体可随意拖动（标题栏按住即拖，无边界限制） =================
  const moveDrag = { active: false }
  header.addEventListener('pointerdown', function (e) {
    if (e.target && e.target.closest && (e.target.closest('button') || e.target.closest('select'))) return
    e.preventDefault()
    try { header.setPointerCapture(e.pointerId) } catch (err) {}
    const r = root.getBoundingClientRect()
    moveDrag.active = true
    moveDrag.dx = e.clientX - r.left
    moveDrag.dy = e.clientY - r.top
    function onMove(ev) {
      root.style.right = 'auto'
      const x = Math.round(ev.clientX - moveDrag.dx)
      const y = Math.round(ev.clientY - moveDrag.dy)
      root.style.left = x + 'px'
      root.style.top = y + 'px'
      panelTop = y
    }
    function onUp() {
      moveDrag.active = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  })

  // 画布区：底部抽屉（详细信息）——列表在上、画布在下；收起后列表占满整个面板高度
  const canvasWrap = el('div', { display: 'none', position: 'absolute', left: '0', right: '0', top: '45%', bottom: '0', zIndex: '20', background: '#0b0f19', flexDirection: 'column' })
  const canvasBar = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', fontSize: '11px', color: '#9ca3af', background: '#111827', borderBottom: '1px solid #1f2937' }, [
    el('span', null, '\u{1F5FA} 总监大画布 · 详细信息（实时 · 拖动节点 / 悬停信息卡 / 画布上审批决策）'),
    el('span', { cursor: 'pointer', color: '#f59e0b', fontWeight: '600' }, '\u6536\u8D77 \u25BC'),
  ])
  canvasBar.children[1].addEventListener('click', function () { canvasOpen = false; render() })
  const canvasFrame = document.createElement('iframe')
  canvasFrame.setAttribute('title', '总监大画布')
  canvasFrame.style.cssText = 'width:calc(100% - 8px);flex:1;border:0;display:block;background:#0b0f19;margin:0 4px;min-height:320px'
  // 画布加载完成后同步当前 scope（避免画布首次打开短暂停留在「全部」）
  canvasFrame.addEventListener('load', function () { notifyCanvas(!scopeChosen) })
  canvasWrap.appendChild(canvasBar)
  canvasWrap.appendChild(canvasFrame)
  function mountCanvas(mount) {
    if (mount) {
      canvasWrap.style.display = 'flex'
      canvasFrame.style.pointerEvents = 'auto' // 兜底：任何异常路径下画布都可交互
      if (canvasFrame.getAttribute('src') !== '/company') canvasFrame.setAttribute('src', '/company')
      syncCanvasHeight()
    } else {
      canvasWrap.style.display = 'none'
      if (canvasFrame.getAttribute('src') === '/company') canvasFrame.removeAttribute('src')
    }
  }
  function syncCanvasHeight() {
    // 覆盖层抽屉：iframe 占满画布条以下空间，列表不再被挤压
    canvasFrame.style.height = 'auto'
  }

  const tabs = el('div', { display: 'flex', gap: '4px', padding: '8px 10px 0' })
  const body = el('div', { padding: '10px', overflowY: 'auto', overflowX: 'hidden', flex: '1', minHeight: '60px' })
  // 部门实时对话区：固定在选项卡上方，有活动时自动出现（聊天气泡样式，边生成边显示）
  const liveWrap = el('div', { display: 'none', padding: '8px 10px 4px', borderBottom: '1px solid #1f2937', background: '#0b0f19' })
  liveWrap.id = 'company-live-wrap'
  const footer = el('div', { padding: '7px 12px', borderTop: '1px solid #1f2937', fontSize: '10px', color: '#6b7280', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, [
    el('span', null, '批准门禁 · 合同冻结 · 所有权互斥 · FAIL→全新 Repair Generator · 2修1重规划后暂停'),
    el('span', { fontSize: '10px', color: '#4b5563' }, '🗺 详细信息为底部抽屉 · 拖任意边界调整大小'),
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
    const h = el('div', { position: 'absolute', zIndex: '31', background: 'transparent' })
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

  const grip = el('div', { position: 'absolute', right: '-6px', bottom: '-6px', width: '26px', height: '26px', cursor: 'nwse-resize', zIndex: '31' })
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
    // 当前会话没有公司任务：自动退回「全部」并提示，避免三个标签页看起来「全空/看不见」
    if (scope && tasks.length === 0) {
      scope = null
      scopeChosen = false
      scopeHint = 'ℹ 当前会话没有公司任务，已自动显示「全部」公司数据（含其他会话的公司项目）。'
      refreshSig = ''
      renderScopeOptions()
      notifyCanvas(false)
      return refreshAll()
    }
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
    if (!auto) scopeHint = ''
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
      // 只自动跟随有公司任务的会话；空会话保持「全部」视图（避免跟随/回退互相打架）
      if ((s.taskCount || 0) === 0) continue
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
    if (transcript) { renderTranscriptView(); root.appendChild(panel); return }
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
    // 部门实时对话区 + 会话范围提示
    if (liveWrap.parentNode !== panel) panel.insertBefore(liveWrap, tabs)
    renderLiveWrap()
    const oldHint = panel.querySelector('#company-scope-hint')
    if (oldHint) oldHint.remove()
    if (scopeHint) {
      const hint = el('div', { margin: '6px 10px 0', padding: '6px 10px', background: '#2b1b10', border: '1px solid #b45309', borderRadius: '8px', fontSize: '11px', color: '#fdba74' }, scopeHint)
      hint.id = 'company-scope-hint'
      panel.insertBefore(hint, tabs)
    }
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
      big.appendChild(el('span', { fontSize: '26px', fontWeight: '800', color: '#f59e0b' }, fmtFull(root.totalTokens)))
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
        const isLive = c.live === true
        const card = el('div', { padding: '7px 8px', marginBottom: '6px', background: '#0b0f19', border: '1px solid #1f2937', borderRadius: '8px', cursor: 'pointer' })
        card.title = '点击查看实时思考/对话'
        card.addEventListener('click', function () { openTranscript(c.id, name, c.model) })
        const line1 = el('div', { display: 'flex', alignItems: 'center', gap: '8px' })
        line1.appendChild(el('span', { flex: 'none', fontSize: '10px', width: '10px' }, isLive ? '🟢' : '⚪'))
        const nameSpan = el('span', { flex: '1', minWidth: '0', fontSize: '12px', fontWeight: '600', color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, name + (isLive ? '（工作中 · 点开看实时思考）' : ''))
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
    const ended = {}
    agentEntries.forEach(function (e) { if (e.kind === 'end' && e.id) ended[e.id] = true })
    body.appendChild(el('div', { fontSize: '11px', color: '#9ca3af', margin: '0 0 6px' }, '共 ' + agentTotal + ' 条（持久累积，跨重启保留；下方为最近 ' + agentEntries.length + ' 条）。💭 点任意一行查看该子代理的实时思考/对话。'))
    for (const e of agentEntries) {
      const isStart = e.kind === 'start'
      const running = isStart && e.id && !ended[e.id]
      const color = isStart ? '#3b82f6' : (e.stopReason && String(e.stopReason).toLowerCase().indexOf('error') >= 0 ? '#ef4444' : '#22c55e')
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid #1f2937', cursor: e.id ? 'pointer' : 'default' })
      if (e.id) {
        row.title = '查看实时思考/对话'
        row.addEventListener('click', function () {
          const role = (e.model ? e.model : '子代理') + '（' + String(e.id).slice(0, 8) + '）'
          openTranscript(e.id, role, e.model)
        })
      }
      row.appendChild(el('span', { fontSize: '10px', width: '64px', flex: 'none', color: '#6b7280' }, (e.at || '').slice(11, 19)))
      row.appendChild(el('span', { fontSize: '10px', padding: '1px 6px', borderRadius: '8px', background: color, color: '#0b0f19', fontWeight: '700', width: '40px', textAlign: 'center', flex: 'none' }, isStart ? '启动' : '结束'))
      row.appendChild(el('span', { flex: 'none', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }, e.provider + ' · ' + String(e.id).slice(0, 8)))
      row.appendChild(el('span', { flex: '1', fontSize: '11px', color: '#7dd3fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, e.model ? e.model + (e.modelProvider ? '（' + e.modelProvider + '）' : '') : '模型待定'))
      if (running) row.appendChild(el('span', { fontSize: '10px', color: '#86efac', flex: 'none', fontWeight: '700' }, '🟢 工作中 · 💭实时'))
      if (!isStart && e.stopReason) row.appendChild(el('span', { fontSize: '10px', color: '#9ca3af', flex: 'none' }, String(e.stopReason).slice(0, 18)))
      body.appendChild(row)
    }
  }

  // ---------- 子部门实时思考/对话（总监实时观看子代理工作过程） ----------
  function openTranscript(sid, label, model) {
    if (!sid) return
    transcript = { sid: String(sid), label: label || '子部门', model: model || '' }
    tcSeq = null
    render()
    refreshTranscript()
  }
  function closeTranscript() {
    transcript = null
    if (tcTimer) { clearInterval(tcTimer); tcTimer = null }
    tcSeq = null
    render()
  }
  function fmtTime(t) {
    if (t === undefined || t === null || t === '') return ''
    try {
      const d = new Date(typeof t === 'number' ? t : t)
      if (isNaN(d.getTime())) return ''
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0')
    } catch (e) { return '' }
  }
  function escHtml(s) {
    return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function blockHtml(b) {
    if (!b) return ''
    if (b.t === 'reasoning') return '<details open class="tc-think"><summary>💭 思考</summary><pre>' + escHtml(b.text) + '</pre></details>'
    if (b.t === 'text') return '<div class="tc-text">💬 ' + mdLite(b.text) + '</div>'
    if (b.t === 'tool') {
      return '<div class="tc-tool"><details' + (b.resultError ? ' open' : '') + '><summary>🛠 ' + escHtml(b.name) + '</summary>' +
        '<div class="tc-k">参数</div><pre>' + escHtml(b.arguments || '') + '</pre>' +
        (b.result !== undefined ? '<div class="tc-k">结果</div><pre class="' + (b.resultError ? 'tc-err' : '') + '">' + escHtml(b.result) + '</pre>' : '') +
        '</details></div>'
    }
    return ''
  }
  function transcriptSig(d) {
    const p = d && d.partial
    return ((d && d.live) ? 'L' : 'E') + '|' + ((d && d.latestSeq !== null && d.latestSeq !== undefined) ? d.latestSeq : '-') + '|' +
      (d && d.entries ? d.entries.length : 0) + '|' +
      (p ? p.blocks.map(function (b) { return (b.text || '').length + ':' + (b.name || '') }).join(',') : '-')
  }
  function updateTranscriptBadge(live, model, provider) {
    const badge = document.getElementById('tc-badge')
    if (!badge) return
    const modelTxt = model ? ' · ' + model + (provider ? '（' + provider + '）' : '') : ''
    if (live) {
      badge.style.background = '#0a2a14'
      badge.style.color = '#86efac'
      badge.style.border = '1px solid #22c55e'
      badge.textContent = '🟢 工作中 · 实时跟随' + modelTxt
    } else {
      badge.style.background = '#1f2937'
      badge.style.color = '#9ca3af'
      badge.style.border = '1px solid #374151'
      badge.textContent = '⚪ 已结束' + modelTxt
    }
  }
  async function refreshTranscript() {
    if (!transcript) return
    try {
      const d = await getJSON('/company-api/agent-transcript?sessionId=' + encodeURIComponent(transcript.sid))
      const sig = transcriptSig(d)
      if (sig === tcSeq) { updateTranscriptBadge(d.live, d.model, d.provider); return }
      tcSeq = sig
      const list = document.getElementById('tc-list')
      if (!list) return
      if (list.dataset.err) delete list.dataset.err
      const nearBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 80
      let html = ''
      for (const e of d.entries || []) {
        if (e.kind === 'user') {
          html += '<div class="tc-user"><div class="tc-meta">📋 任务要求' + (e.time ? ' · ' + fmtTime(e.time) : '') + '</div><div class="tc-md">' + mdLite(e.text) + '</div></div>'
        } else if (e.kind === 'assistant') {
          const label = e.step !== undefined ? '第 ' + e.step + ' 步' : '回复'
          html += '<div class="tc-assistant"><div class="tc-meta">💬 ' + label + (e.time ? ' · ' + fmtTime(e.time) : '') + (e.usage ? ' · ⚡' + fmt(e.usage.outputTokens || 0) : '') + '</div>' + (e.blocks || []).map(blockHtml).join('') + '</div>'
        }
      }
      if (d.partial && d.partial.blocks && d.partial.blocks.length) {
        html += '<div class="tc-assistant tc-partial"><div class="tc-meta">✍️ 正在输出… <span class="tc-cur">▍</span></div>' + d.partial.blocks.map(blockHtml).join('') + '</div>'
      }
      if (!html) html = '<div class="tc-empty">暂无对话内容（会话刚开始、消息尚未落地，或已结束且无消息记录）。</div>'
      list.innerHTML = html
      if (nearBottom) body.scrollTop = body.scrollHeight
      updateTranscriptBadge(d.live, d.model, d.provider)
    } catch (e) {
      // 会话可能刚结束/引擎繁忙：保留上一次内容，1.5s 后自动重试
      const list = document.getElementById('tc-list')
      if (list && !list.dataset.err && (!list.children.length || (list.children.length === 1 && list.children[0].className === 'tc-empty'))) {
        list.dataset.err = '1'
        list.innerHTML = '<div class="tc-empty">⚠ 读取失败：公司引擎需要更新（新开一个公司会话或重启 DSH 后生效）；若是刚结束的会话，稍后自动重试。</div>'
      }
    }
  }
  let tcStylesInjected = false
  function injectTranscriptStyles() {
    if (tcStylesInjected) return
    tcStylesInjected = true
    const s = document.createElement('style')
    s.id = 'company-tc-styles'
    s.textContent = [
      '#tc-list { display:flex; flex-direction:column; gap:8px; }',
      '.tc-user, .tc-assistant { border:1px solid #1f2937; border-radius:10px; padding:8px 10px; background:#0b0f19; }',
      '.tc-user pre, .tc-assistant pre { margin:6px 0 0; padding:8px; background:#111827; border:1px solid #1f2937; border-radius:8px; font-size:11px; white-space:pre-wrap; word-break:break-word; color:#cbd5e1; max-height:260px; overflow:auto; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }',
      '.tc-meta { font-size:10.5px; color:#6b7280; margin-bottom:4px; }',
      '.tc-k { font-size:10px; color:#6b7280; margin-top:6px; }',
      '.tc-text { white-space:pre-wrap; word-break:break-word; color:#e5e7eb; }',
      '.tc-think summary, .tc-tool summary { cursor:pointer; color:#7dd3fc; font-size:11px; font-weight:600; }',
      '.tc-think pre { background:#0e2a43; border-color:#1e4a6b; color:#bfdbfe; }',
      '.tc-err { color:#fca5a5; border-color:#7f1d1d !important; }',
      '.tc-partial { border-color:#a78bfa; }',
      '.tc-cur { animation:tcBlink 0.9s steps(2) infinite; color:#a78bfa; }',
      '@keyframes tcBlink { 50% { opacity:0; } }',
      '.tc-empty { color:#6b7280; font-size:12px; padding:12px 4px; }',
    ].join('\n')
    document.head.appendChild(s)
  }
  function renderTranscriptView() {
    injectTranscriptStyles()
    tabs.innerHTML = ''
    const back = el('button', btnStyle('#94a3b8'), '← 返回')
    back.addEventListener('click', closeTranscript)
    tabs.appendChild(back)
    body.innerHTML = ''
    const head = el('div', { padding: '2px 2px 10px', borderBottom: '1px solid #1f2937', marginBottom: '8px' })
    head.appendChild(el('div', { fontWeight: '700', fontSize: '14px', color: '#e5e7eb' }, '💭 ' + (transcript.label || '子部门') + ' · 实时思考/对话'))
    head.appendChild(el('div', { color: '#9ca3af', marginTop: '3px', fontSize: '11px' }, '会话 ' + String(transcript.sid || '').slice(0, 8) + ' · 1.5s 增量拉取 · 思考/对话/工具调用边生成边显示'))
    const badge = el('span', { fontSize: '11px', padding: '2px 8px', borderRadius: '8px', background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', marginLeft: '8px' }, '⚪ 状态未知')
    badge.id = 'tc-badge'
    head.appendChild(badge)
    body.appendChild(head)
    const list = el('div', {})
    list.id = 'tc-list'
    list.innerHTML = '<div class="tc-empty">加载中…</div>'
    body.appendChild(list)
    if (!tcTimer) tcTimer = setInterval(refreshTranscript, 1500)
  }

  // ---------- 部门实时对话引擎（面板区 liveWrap + 主界面悬浮对话坞 dock） ----------
  let dockDismissed = false
  function lfEsc(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
  function lfShort(s, n) { const t = String(s || ''); return t.length > n ? t.slice(0, n) + '…' : t }
  // 轻量 Markdown（主界面观感）：代码块 / 行内代码 / 粗体 / 标题
  function mdLite(s) {
    let out = lfEsc(s)
    out = out.replace(/```([\s\S]*?)```/g, function (m, code) { return '<pre class="lf-code">' + code.replace(/^\n/, '') + '</pre>' })
    out = out.replace(/`([^`\n]+)`/g, '<code class="lf-code-i">$1</code>')
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    out = out.replace(/^#{1,4}\s+(.+)$/gm, '<b class="lf-h">$1</b>')
    out = out.replace(/^- (.+)$/gm, '• $1')
    return out
  }
  function lfBubbles(d, cap) {
    const list = (d && d.entries) ? d.entries.slice(-(cap || 8)) : []
    const out = []
    list.forEach(function (e, i) {
      if (e.kind === 'user') { if (i === 0) out.push({ kind: 'user', text: e.text }); return }
      if (e.kind !== 'assistant' || !e.blocks) return
      for (const b of e.blocks) out.push({ kind: b.t, text: b.text, name: b.name, arguments: b.arguments, result: b.result, resultError: b.resultError })
    })
    if (d && d.partial && d.partial.blocks && d.partial.blocks.length) {
      for (const b of d.partial.blocks) out.push({ kind: b.t, text: b.text, name: b.name, arguments: b.arguments, streaming: true })
    }
    return out
  }
  // Think 行：模仿主界面（Think 标题 + 首行摘要，点击展开全文）
  function lfThinkHtml(text, streaming) {
    const t = String(text || '')
    const first = t.split('\n').find(function (l) { return l.trim() }) || ''
    return '<div class="lf-think' + (streaming ? ' lf-stream' : '') + '" title="点击展开/收起思考">' +
      '<span class="lf-think-ic">🧠</span><span class="lf-think-t">Think</span>' +
      '<span class="lf-think-s">' + lfEsc(lfShort(first, 110)) + '</span>' +
      '<div class="lf-think-full" style="display:none;">' + lfEsc(t) + '</div></div>'
  }
  function lfCardHtml(sid) {
    const f = liveFeeds[sid]
    if (!f) return ''
    const d = f.d || {}
    const live = !!d.live
    const rows = lfBubbles(d, 8).map(function (b) {
      if (b.kind === 'user') return '<div class="lf-user">📋 ' + mdLite(lfShort(b.text, 320)) + '</div>'
      if (b.kind === 'reasoning') return lfThinkHtml(b.text, !!b.streaming)
      if (b.kind === 'text') return '<div class="lf-text' + (b.streaming ? ' lf-stream' : '') + '">' + mdLite(b.text) + (b.streaming ? '<span class="lf-cur">▍</span>' : '') + '</div>'
      if (b.kind === 'tool') return '<div class="lf-tool">🛠 <b>' + lfEsc(b.name || '工具') + '</b>' + (b.arguments ? ' <span class="lf-tool-args">' + lfEsc(lfShort(b.arguments, 140)) + '</span>' : '') + (b.result !== undefined ? '<div class="lf-res' + (b.resultError ? ' lf-res-err' : '') + '">📥 ' + lfEsc(lfShort(b.result, 260)) + '</div>' : '') + '</div>'
      return ''
    }).join('')
    return '<div class="lf-card" data-sid="' + lfEsc(sid) + '">' +
      '<div class="lf-head"><span class="lf-name">💭 ' + lfEsc(f.label || '子部门') + (f.taskId ? ' · ' + lfEsc(f.taskId) : '') + '</span>' +
      '<span class="lf-model">' + lfEsc(f.model || '') + '</span>' +
      '<span class="lf-status">' + (live ? '🟢 工作中' : '⚪ 已结束') + '</span></div>' +
      '<div class="lf-body">' + (rows || '<div class="lf-empty">会话刚开始，等待第一条消息…</div>') + '</div>' +
      '<div class="lf-foot"><button class="lf-btn" data-act="open">查看全部对话 →</button></div>' +
      '</div>'
  }
  function lfSidOrder() {
    const sids = Object.keys(liveFeeds)
    return sids.sort(function (a, b) {
      const la = !!(liveFeeds[a].d && liveFeeds[a].d.live)
      const lb = !!(liveFeeds[b].d && liveFeeds[b].d.live)
      if (la !== lb) return la ? -1 : 1
      return (liveFeeds[b].at || 0) - (liveFeeds[a].at || 0)
    })
  }
  function lfBindClicks(container) {
    if (!container || container.dataset.lfBound) return
    container.dataset.lfBound = '1'
    container.addEventListener('click', function (e) {
      const t = e.target
      const think = t && t.closest ? t.closest('.lf-think') : null
      if (think) {
        const full = think.querySelector('.lf-think-full')
        if (full) full.style.display = full.style.display === 'none' ? 'block' : 'none'
        return
      }
      const btn = t && t.closest ? t.closest('[data-act]') : null
      const card = t && t.closest ? t.closest('.lf-card') : null
      if (!card) return
      if (btn) { openTranscript(card.getAttribute('data-sid'), (liveFeeds[card.getAttribute('data-sid')] || {}).label, (liveFeeds[card.getAttribute('data-sid')] || {}).model); return }
      openTranscript(card.getAttribute('data-sid'), (liveFeeds[card.getAttribute('data-sid')] || {}).label, (liveFeeds[card.getAttribute('data-sid')] || {}).model)
    })
  }
  // 内容签名：包含每会话的最新 seq 与流式半成品文本长度——文本在增长就必须重绘（流式观感）
  function lfContentSig(show) {
    return show.map(function (k) {
      const f = liveFeeds[k]
      const d = f.d || {}
      const p = d.partial
      const plen = p && p.blocks ? p.blocks.map(function (b) { return (b.text || '').length + ':' + (b.name || '') }).join(',') : '-'
      return k.slice(0, 12) + ':' + (d.live ? 'L' : 'E') + ':' + ((d.latestSeq === undefined || d.latestSeq === null) ? '-' : d.latestSeq) + ':' + ((d.entries || []).length) + ':' + plen
    }).join('|')
  }
  function renderLiveWrap() {
    if (!liveWrap || liveWrap.parentNode !== panel) return
    const sids = lfSidOrder()
    const nowT = Date.now()
    const live = sids.filter(function (k) { return liveFeeds[k].d && liveFeeds[k].d.live })
    const idle = sids.filter(function (k) { return liveFeeds[k].d && !liveFeeds[k].d.live && nowT - liveFeeds[k].at < 300000 })
    const show = live.concat(idle)
    if (show.length === 0) { if (liveWrap.style.display !== 'none') { liveWrap.style.display = 'none'; liveWrap.innerHTML = '' } return }
    const sig = lfContentSig(show)
    if (liveWrap.dataset.sig === sig && liveWrap.style.display !== 'none') return
    liveWrap.dataset.sig = sig
    liveWrap.style.display = 'block'
    liveWrap.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
      '<span style="font-weight:700;font-size:12px;color:#a78bfa;">💭 部门实时对话（边生成边显示 · 1.5s 增量）</span>' +
      '<span style="font-size:10px;color:#6b7280;">' + (live.length ? live.length + ' 个部门工作中' : '暂无进行中部门') + ' · 点击卡片查看完整对话</span></div>' +
      '<div class="lf-list" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;">' + show.map(lfCardHtml).join('') + '</div>'
    lfBindClicks(liveWrap)
  }
  function renderDock() {
    const sids = lfSidOrder()
    const nowT = Date.now()
    const live = sids.filter(function (k) { return liveFeeds[k].d && liveFeeds[k].d.live })
    const idle = sids.filter(function (k) { return liveFeeds[k].d && !liveFeeds[k].d.live && nowT - liveFeeds[k].at < 60000 })
    const show = live.concat(idle)
    if (show.length === 0 || (live.length === 0 && dockDismissed)) { dock.style.display = 'none'; dock.dataset.sig = ''; return }
    dock.style.display = 'flex'
    const sig = lfContentSig(show) + '|' + (dockCollapsed ? 'c' : 'o')
    if (dock.dataset.sig === sig) return
    dock.dataset.sig = sig
    const head = '<div class="lf-dock-head" id="lf-dock-head" style="cursor:grab;user-select:none;display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1f2937;border-bottom:1px solid #374151;">' +
      '<span style="flex:1;font-weight:700;font-size:12.5px;color:#a78bfa;">💭 部门实时对话' + (live.length ? ' · ' + live.length + ' 个工作中' : '') + '</span>' +
      '<button class="lf-dbtn" data-act="collapse" style="pointer-events:auto;cursor:pointer;background:transparent;border:1px solid #4b5563;color:#9ca3af;border-radius:6px;font-size:11px;padding:2px 8px;">' + (dockCollapsed ? '▤' : '▁') + '</button>' +
      '<button class="lf-dbtn" data-act="dismiss" style="pointer-events:auto;cursor:pointer;background:transparent;border:1px solid #4b5563;color:#9ca3af;border-radius:6px;font-size:11px;padding:2px 8px;">✕</button>' +
      '</div>'
    const bodyHtml = dockCollapsed ? '' : '<div class="lf-list" style="padding:8px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:calc(44vh - 46px);">' + show.map(lfCardHtml).join('') + '</div>'
    dock.innerHTML = head + bodyHtml
    lfBindClicks(dock)
    const dh = dock.querySelector('#lf-dock-head')
    if (dh && !dh.dataset.dragBound) {
      dh.dataset.dragBound = '1'
      dh.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest ? e.target.closest('.lf-dbtn') : null
        if (!btn) return
        const act = btn.getAttribute('data-act')
        if (act === 'collapse') { dockCollapsed = !dockCollapsed; dock.dataset.sig = ''; renderDock() }
        else if (act === 'dismiss') { dockDismissed = true; dock.style.display = 'none'; dock.dataset.sig = '' }
      })
      dh.addEventListener('pointerdown', function (e) {
        if (e.target && e.target.closest && e.target.closest('.lf-dbtn')) return
        e.preventDefault()
        try { dh.setPointerCapture(e.pointerId) } catch (err) {}
        const r = dock.getBoundingClientRect()
        const dx = e.clientX - r.left, dy = e.clientY - r.top
        function onMove(ev) {
          dock.style.right = 'auto'
          dock.style.bottom = 'auto'
          dock.style.left = Math.round(ev.clientX - dx) + 'px'
          dock.style.top = Math.round(ev.clientY - dy) + 'px'
        }
        function onUp() {
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.removeEventListener('pointercancel', onUp)
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', onUp)
      })
    }
  }
  async function liveFeedTick() {
    const nowT = Date.now()
    if (nowT - liveTickAt < 1200) return
    liveTickAt = nowT
    try {
      const scopeQ = scope ? '?scope=' + encodeURIComponent(scope) : ''
      const c = await getJSON('/company-api/canvas' + scopeQ)
      for (const r of c.roles || []) if (r && r.id) roleTitles[r.id] = r.title
      const live = []
      const seen = {}
      for (const d of c.dispatches || []) {
        if (!d.live || !d.sessionId || seen[d.sessionId]) continue
        seen[d.sessionId] = true
        live.push(d)
      }
      const sids = live.map(function (x) { return x.sessionId }).sort().join(',')
      if (sids !== lastLiveSids) { lastLiveSids = sids; if (live.length) dockDismissed = false }
      for (const d of live.slice(0, 3)) {
        const sid = d.sessionId
        const f = liveFeeds[sid] || { at: 0 }
        if (nowT - f.at < 900) continue
        f.at = nowT
        try {
          const t = await getJSON('/company-api/agent-transcript?sessionId=' + encodeURIComponent(sid))
          f.d = t
          f.model = t.model || d.model || f.model || ''
          f.label = deptLabel(d.dept) || f.label || '子部门'
          f.taskId = d.taskId || f.taskId
          liveFeeds[sid] = f
        } catch (e) { /* 会话刚结束/引擎未就绪：保留旧内容 */ }
      }
      for (const k of Object.keys(liveFeeds)) { if (nowT - liveFeeds[k].at > 600000) delete liveFeeds[k] }
      renderLiveWrap()
      renderDock()
    } catch (e) { /* 引擎未挂载时静默，等下一轮 */ }
  }
  function deptLabel(id) {
    if (roleTitles[id]) return roleTitles[id]
    if (id === 'coordinator') return '总控 Coordinator'
    return id || '子部门'
  }
  let lfStylesInjected = false
  function injectLiveStyles() {
    if (lfStylesInjected) return
    lfStylesInjected = true
    const s = document.createElement('style')
    s.id = 'company-lf-styles'
    s.textContent = [
      '.lf-card { border:1px solid #374151; border-radius:10px; background:#0b0f19; overflow:hidden; }',
      '.lf-head { display:flex; align-items:center; gap:6px; padding:6px 10px; background:#111827; border-bottom:1px solid #1f2937; flex-wrap:wrap; }',
      '.lf-name { font-weight:700; font-size:12px; color:#e5e7eb; }',
      '.lf-model { font-size:10px; color:#7dd3fc; background:#0e2a43; padding:1px 6px; border-radius:8px; }',
      '.lf-status { font-size:10px; color:#86efac; }',
      '.lf-body { padding:8px 10px; display:flex; flex-direction:column; gap:6px; }',
      '.lf-user { font-size:11px; color:#9ca3af; border-left:2px solid #3b82f6; padding-left:8px; white-space:pre-wrap; word-break:break-word; }',
      '.lf-think { display:flex; align-items:baseline; gap:6px; cursor:pointer; font-size:11px; color:#93c5fd; background:#0e2a43; border:1px solid #1e4a6b; border-radius:6px; padding:4px 8px; }',
      '.lf-think-ic { flex:none; }',
      '.lf-think-t { flex:none; font-weight:600; }',
      '.lf-think-s { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#bfdbfe; flex:1; min-width:0; }',
      '.lf-think-full { margin-top:4px; white-space:pre-wrap; word-break:break-word; color:#bfdbfe; border-top:1px dashed #1e4a6b; padding-top:4px; font-size:11px; }',
      '.lf-text { white-space:pre-wrap; word-break:break-word; color:#e5e7eb; font-size:12px; line-height:1.55; }',
      '.lf-tool { font-size:11px; color:#c4b5fd; background:#150b2e; border:1px solid #4c1d95; border-radius:6px; padding:4px 8px; }',
      '.lf-tool b { color:#a78bfa; }',
      '.lf-tool-args { color:#8b5cf6; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10px; word-break:break-all; }',
      '.lf-res { margin-top:4px; color:#9ca3af; font-size:10.5px; white-space:pre-wrap; word-break:break-word; border-top:1px solid #312e81; padding-top:4px; }',
      '.lf-res-err { color:#fca5a5; }',
      '.lf-cur { animation:tcBlink .9s steps(2) infinite; color:#a78bfa; }',
      '.lf-foot { padding:2px 10px 6px; text-align:right; }',
      '.lf-btn { cursor:pointer; background:transparent; border:1px solid #a78bfa; color:#c4b5fd; border-radius:6px; font-size:11px; padding:3px 10px; }',
      '.lf-empty { color:#6b7280; font-size:11px; padding:6px 2px; }',
      '.tc-md { white-space:pre-wrap; word-break:break-word; color:#cbd5e1; font-size:11.5px; line-height:1.6; }',
      '.lf-code { margin:6px 0; padding:7px 9px; background:#0f172a; border:1px solid #1f2937; border-radius:6px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10.5px; white-space:pre-wrap; word-break:break-word; color:#cbd5e1; max-height:220px; overflow:auto; }',
      '.lf-code-i { background:#1f2937; border-radius:4px; padding:0 4px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10.5px; color:#7dd3fc; }',
      '.lf-h { display:block; margin:4px 0 2px; font-weight:700; }',
      '@media (prefers-color-scheme: light) {',
      '  .lf-card { border-color:#e2e8f0; background:#ffffff; }',
      '  .lf-head { background:#f8fafc; border-color:#e2e8f0; }',
      '  .lf-name { color:#1e293b; }',
      '  .lf-text { color:#1e293b; }',
      '  .lf-user { color:#64748b; }',
      '  .lf-think { background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8; }',
      '  .lf-think-s, .lf-think-full { color:#1e40af; }',
      '  .lf-tool { background:#f5f3ff; border-color:#ddd6fe; color:#6d28d9; }',
      '  .lf-res { color:#64748b; }',
      '}',
    ].join('\n')
    document.head.appendChild(s)
  }
  injectLiveStyles()

  render()
  refreshAll()
  setInterval(function () { if (open) refreshAll() }, 2000)
  setInterval(liveFeedTick, 1500)
  liveFeedTick()
  }

  window.__ModuleLoader__.load({
    id: 'software-company-panel',
    factory: function () {
      var plugin = { apply: function () { installPanel() } }
      return { apply: plugin.apply, default: plugin }
    },
  })
})()
