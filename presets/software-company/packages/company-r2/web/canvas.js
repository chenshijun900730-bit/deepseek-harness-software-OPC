/* 总监大画布数据层：1s 增量拉取多项目合并事件流（ts 游标）+ 快照，前端线性补间渲染。零依赖。 */
(function () {
  'use strict'
  var $ = function (id) { return document.getElementById(id) }
  var cv = $('cv')
  var STATE = { view: 'org', tasks: [], events: [], since: '', seenKeys: new Set(), depts: {}, dispatchDepts: {}, roles: [], dispatches: [], contracts: [], flowNodes: [], sessions: [], scope: null, scopeChosen: false, done: {}, started: new Set(), ready: new Set(), current: null, flow: null, focusTask: null, workingStage: null, concurrency: 3, orgSig: '', flowSig: '' }
  // 独立窗口模式：面板「⧉ 独立窗口」弹出时带当前 scope（?scope=sessionId）
  try {
    var qsScope = new URLSearchParams(window.location.search).get('scope')
    if (qsScope) STATE.scope = qsScope
  } catch (e) {}
  var DRAG = null
  var ACTIVE_EXEC = ['IMPLEMENTING', 'SELF_CHECK', 'INTEGRATING', 'QA_RUNNING', 'REPAIRING', 'REPLANNING', 'FINAL_E2E']
  function isWorkingNow(n) {
    var dispatched = (STATE.dispatchDepts[STATE.focusTask] || []).indexOf(n.dept) >= 0
    return STATE.workingStage === n.id || STATE.started.has(n.id) || dispatched || (ACTIVE_EXEC.indexOf(STATE.current) >= 0 && STATE.ready.has(n.id))
  }

  var STATUS_STYLE = {
    working: { border: '#a78bfa', bg: '#150b2e', color: '#c4b5fd' },
    queued: { border: '#3b82f6', bg: '#0a1626', color: '#93c5fd' },
    idle: { border: '#4b5563', bg: '#111827', color: '#9ca3af' },
    done: { border: '#22c55e', bg: '#0a1f12', color: '#86efac' },
    blocked: { border: '#7f1d1d', bg: '#180909', color: '#fca5a5' },
  }

  function api(path, timeoutMs) {
    var ctl = typeof AbortController === 'undefined' ? null : new AbortController()
    var timer = null
    if (ctl !== null) {
      timer = setTimeout(function () { try { ctl.abort() } catch (e) {} }, timeoutMs || 8000)
    }
    return fetch(path, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (timer) clearTimeout(timer)
      if (!r.ok) throw new Error('HTTP ' + r.status)
      // /company-api 只在公司引擎（Software Company 预置）挂载时注册；未挂载时
      // 请求落到宿主 SPA fallback，返回 HTML。此时 r.json() 会抛 SyntaxError 且
      // 被静默吞掉 → 画布永远空白。这里显式识别并给出可读错误。
      var ct = String(r.headers.get('content-type') || '')
      if (ct.indexOf('json') === -1) throw new Error('engine-not-mounted (content-type=' + ct + ')')
      return r.json()
    }, function (e) {
      if (timer) clearTimeout(timer)
      // 超时/中止归一为可识别错误：保留上一次数据，不弹「引擎未挂载」横幅
      throw new Error((e && e.name === 'AbortError') ? 'timeout' : String((e && e.message) || e))
    })
  }
  function fmt(n) { return n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : (n / 1000).toFixed(1) + 'k' }
  function fmtFull(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

  // ================= 引擎不可用提示 =================
  // /company-api 由 Software Company 预置（按会话挂载）注册；仅宿主面板常驻。
  // 无公司会话时画布数据接口不可用 → 显示明确横幅（不再静默空白），数据恢复后自动隐藏。
  var engineDown = false
  var engineDownKind = ''
  function showEngineDown(on, kind) {
    if (on === engineDown && (!on || kind === engineDownKind)) return
    engineDown = on
    engineDownKind = on ? (kind || 'down') : ''
    var b = $('engineBanner')
    if (!b) return
    if (!on) { b.style.display = 'none'; return }
    if (engineDownKind === 'slow') {
      b.innerHTML = '🐢 数据更新超时：公司引擎繁忙（开发中的 token 快照可能较慢）。画布保留上一次数据，每 2s 自动重试；<br/>若长时间无数据，可关闭当前公司会话后新开一个公司会话让引擎热加载修复。'
      b.style.background = '#1a1c10'
      b.style.borderColor = '#a3a029'
      b.style.color = '#e5e37a'
    } else {
      b.innerHTML = '⚠ 画布数据不可用：当前会话未挂载公司引擎（<code>/company-api</code> 无响应，返回的是宿主页面而非 JSON）。<br/>请在会话模式选择器中切换到 <b>Software Company 公司模式</b>（或打开一个公司会话），画布会每 2s 自动重试并开始拉取真实数据。'
      b.style.background = '#2b1b10'
      b.style.borderColor = '#b45309'
      b.style.color = '#fdba74'
    }
    b.style.display = 'block'
  }
  // 画布数据请求在飞标记：服务器慢时避免 2s 轮询把连接池/请求栈堆满
  var canvasFetchPending = false

  function layout(nodes) {
    var pos = {}, placed = new Set(), rows = []
    while (placed.size < nodes.length) {
      var ready = nodes.filter(function (n) { return !placed.has(n.id) && (n.needs || []).every(function (x) { return placed.has(x) || !nodes.some(function (m) { return m.id === x }) }) })
      if (ready.length === 0) ready = nodes.filter(function (n) { return !placed.has(n.id) })
      rows.push(ready); ready.forEach(function (n) { placed.add(n.id) })
    }
    rows.forEach(function (row, i) {
      var x = 30 + i * 160
      var y0 = 150 - ((row.length - 1) * 50)
      row.forEach(function (n, j) { pos[n.id] = { x: x, y: y0 + j * 100 } })
    })
    return pos
  }

  function renderNodes(flow) {
    if (!cv) return
    if (DRAG && !DRAG.org) return // 流程视图拖拽中：重建会丢失拖拽引用，挂起待拖完
    if (DRAG && !DRAG.el.isConnected) cancelDrag()
    cv.querySelectorAll('.nd').forEach(function (el) { if (el.id !== 'nd-coord') el.remove() })
    cv.querySelectorAll('.call').forEach(function (el) { el.remove() })
    var coord = $('nd-coord'); if (coord) coord.style.display = ''
    var ph = $('nd-placeholder'); if (ph) ph.remove()
    if (!flow) return
    var nodes = flow.nodes.filter(function (n) { return !n.skipped })
    var pos = layout(nodes)
    nodes.forEach(function (n) {
      var st = STATE.done[n.id] ? 'done' : (isWorkingNow(n) ? 'working' : 'queued')
      var s = STATUS_STYLE[st]
      var el = document.createElement('div')
      el.className = 'nd' + (st === 'working' ? ' work' : '')
      el.id = 'nd-' + n.id
      el.style.cssText = 'left:' + pos[n.id].x + 'px;top:' + pos[n.id].y + 'px;width:130px;border-color:' + s.border + ';background:' + s.bg + ';color:' + s.color
      var toks = STATE.depts[n.dept] ? ' · ⚡ ' + fmt(STATE.depts[n.dept].totalTokens) : ''
      el.innerHTML = (st === 'done' ? '✅ ' : (st === 'working' ? '⚙ ' : '⏳ ')) + (n.title || n.id) + '<small>' + n.dept + toks + '</small>'
      el.addEventListener('click', function () { if (justMoved) return; openDept(n) })
      el.addEventListener('pointerdown', startDrag)
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
    return '<h4>' + (n.title || n.id) + '</h4><div>' + (STATE.done[n.id] ? '✅ 已完成' : (isWorkingNow(n) ? '⚙ 工作中' : '⏳ 排队/等待')) + '</div>' +
      '<div style="color:#9ca3af;margin-top:3px;">部门：' + n.dept + ' · 模型：' + (d.model || '?') + ' · ' + (d.reasoning || '?') + '<br/>token 本轮 ' + fmt(d.totalTokens || 0) + ' · 表面 ' + fmt(d.surfaceTokens || 0) + ' · 排名 ' + (d.rank || '-') + '</div>'
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
    if (typeof node === 'string') {
      if (node === 'coord') { window.__openCoord(); return }
      node = { dept: node, title: node }
    }
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

  // ================= 组织视图：14 部门底卡全量连线 + 每次调用叠加调用卡 =================
  var ORG = [
    { id: 'coordinator', x: 613, y: 22, w: 150 },
    { id: 'planner', x: 140, y: 150, w: 150, chain: 'explorer' },
    { id: 'explorer', x: 140, y: 280, w: 150, chain: 'architect' },
    { id: 'architect', x: 140, y: 410, w: 150 },
    { id: 'generator', x: 430, y: 150, w: 150, chain: 'department-generator' },
    { id: 'department-generator', x: 430, y: 280, w: 150, chain: 'integrator' },
    { id: 'integrator', x: 430, y: 410, w: 150 },
    { id: 'qa-runner', x: 720, y: 150, w: 150, chain: 'sprint-evaluator' },
    { id: 'sprint-evaluator', x: 720, y: 280, w: 150, chain: 'final-evaluator' },
    { id: 'final-evaluator', x: 720, y: 410, w: 150 },
    { id: 'security-reviewer', x: 1010, y: 120, w: 170, chain: 'mechanical-worker' },
    { id: 'mechanical-worker', x: 1010, y: 230, w: 170, chain: 'recorder' },
    { id: 'recorder', x: 1010, y: 340, w: 170, chain: 'repair-generator' },
    { id: 'repair-generator', x: 1010, y: 450, w: 170 },
  ]
  function roleOf(id) {
    for (var i = 0; i < (STATE.roles || []).length; i++) if (STATE.roles[i].id === id) return STATE.roles[i]
    return { id: id, title: id, model: '?', reasoning: '?' }
  }
  function deptCalls(id) {
    return (STATE.dispatches || []).filter(function (d) { return d.dept === id && (!STATE.focusTask || d.taskId === STATE.focusTask) })
  }
  function orgSignature() {
    var deptsSig = Object.keys(STATE.depts || {}).map(function (k) { return k + ':' + Math.round((STATE.depts[k].totalTokens || 0) / 1000) }).join(',')
    var doneSig = Object.keys(STATE.done || {}).join(',')
    var contractsSig = (STATE.contracts || []).map(function (c) { return c.from + '>' + c.to + (c.signed ? '✓' : '') }).join(',')
    return [STATE.focusTask || '', (STATE.dispatches || []).length, (STATE.roles || []).length, deptsSig, doneSig, contractsSig].join('|')
  }
  var badgePrevTotal = {}
  var badgePrevSurface = {}
  function updateDeptBadges() {
    ORG.forEach(function (o) {
      var el = $('nd-dept-' + o.id)
      if (!el) return
      var d = STATE.depts[o.id] || {}
      var t = el.querySelector('.dtok')
      if (t) {
        var txt = '⚡' + fmt(d.totalTokens || 0)
        if (t.textContent !== txt) t.textContent = txt
      }
      var s = el.querySelector('.dsurf')
      if (s) {
        var stxt = '⇧' + fmt(d.surfaceTokens || 0)
        if (s.textContent !== stxt) s.textContent = stxt
      }
      // 活跃高亮：token 总量或表面在增长 → 卡片发光 + ⚡ 琥珀色，不再静止灰色
      var total = d.totalTokens || 0
      var surf = d.surfaceTokens || 0
      var growing = (badgePrevTotal[o.id] !== undefined && total > badgePrevTotal[o.id]) ||
                    (badgePrevSurface[o.id] !== undefined && surf > badgePrevSurface[o.id])
      if (growing) {
        el.dataset.glow = '1'
        el.style.borderColor = '#a78bfa'
        el.style.boxShadow = '0 0 14px rgba(167,139,250,.6)'
        if (t) t.style.color = '#fbbf24'
        if (s) s.style.color = '#7dd3fc'
      } else if (el.dataset.glow) {
        delete el.dataset.glow
        el.style.borderColor = ''
        el.style.boxShadow = ''
        if (t) t.style.color = ''
        if (s) s.style.color = ''
      }
      badgePrevTotal[o.id] = total
      badgePrevSurface[o.id] = surf
    })
  }
  function renderOrg() {
    if (!cv) return
    // 数据无变化时不整树重建（消除每 2s 轮询带来的闪动），只原位更新 token 徽标
    var sig = orgSignature()
    if (sig === STATE.orgSig) { updateDeptBadges(); return }
    if (DRAG && DRAG.org) {
      // 拖拽进行中不重建：旧元素一旦移除，拖拽代码会从脱离文档的元素读
      // offsetLeft(恒 0) 把布局坐标写成 (0,0)，节点瞬间跳到左上角。
      // 不推进 orgSig —— 拖完由 endDrag 的 renderCurrent 按最新数据重建，
      // 此时 ORG 坐标已含本次拖动的新位置。
      updateDeptBadges()
      return
    }
    if (DRAG && !DRAG.el.isConnected) cancelDrag()
    STATE.orgSig = sig
    cv.querySelectorAll('.nd').forEach(function (el) { if (el.id !== 'nd-coord') el.remove() })
    cv.querySelectorAll('.call').forEach(function (el) { el.remove() })
    cv.querySelectorAll('.cicon').forEach(function (el) { el.remove() })
    var coord = $('nd-coord'); if (coord) coord.style.display = 'none'
    var ph = $('nd-placeholder'); if (ph) ph.remove()
    var names = {}
    ;(STATE.roles || []).forEach(function (r) { names[r.id] = r })
    // 聚焦任务各环节的部门归属与完结统计（环节全部完结的部门标绿）
    var flowDepts = {}, doneDepts = {}
    ;(STATE.flowNodes || []).forEach(function (n) {
      flowDepts[n.dept] = (flowDepts[n.dept] || 0) + 1
      if (STATE.done[n.id]) doneDepts[n.dept] = (doneDepts[n.dept] || 0) + 1
    })
    // 接下来两步的交接：step1=目标环节已就绪（依赖全部完结）；step2=目标环节的
    // 依赖 ⊆ 已完结 ∪ 就绪（下一步完成后即交接）
    var doneSet = new Set(Object.keys(STATE.done || {}))
    var readySet = new Set()
    ;(STATE.flowNodes || []).forEach(function (n) {
      if (doneSet.has(n.id)) return
      var allDone = (n.needs || []).every(function (x) { return doneSet.has(x) || !(STATE.flowNodes || []).some(function (m) { return m.id === x }) })
      if (allDone) readySet.add(n.id)
    })
    var nextHandoffs = []
    ;(STATE.flowNodes || []).forEach(function (n) {
      if (doneSet.has(n.id)) return
      var needs = n.needs || []
      if (!needs.length) return
      var allDone = needs.every(function (x) { return doneSet.has(x) })
      if (allDone) {
        needs.forEach(function (m) { nextHandoffs.push({ from: m, to: n.id, step: 1 }) })
      } else if (needs.every(function (x) { return doneSet.has(x) || readySet.has(x) })) {
        needs.forEach(function (m) { if (doneSet.has(m) || readySet.has(m)) nextHandoffs.push({ from: m, to: n.id, step: 2 }) })
      }
    })
    STATE.nextHandoffs = nextHandoffs
    var nodes = ORG.filter(function (o) { return true })
    nodes.forEach(function (o) {
      var r = roleOf(o.id)
      var calls = deptCalls(o.id)
      var d = STATE.depts[o.id] || {}
      var allDone = flowDepts[o.id] && doneDepts[o.id] === flowDepts[o.id]
      var st = o.id === 'coordinator' ? 'working' : (allDone ? 'done' : (calls.length ? 'working' : 'idle'))
      var s = STATUS_STYLE[st]
      var el = document.createElement('div')
      el.className = 'nd' + (st === 'working' ? ' work' : '')
      el.id = 'nd-dept-' + o.id
      el.style.cssText = 'left:' + o.x + 'px;top:' + o.y + 'px;width:' + o.w + 'px;border-color:' + s.border + ';background:' + s.bg + ';color:' + s.color
      var toks = d.totalTokens ? ' · <span class="dtok">⚡' + fmt(d.totalTokens) + '</span>' : ' · <span class="dtok">⚡0</span>'
      var surfs = ' · <span class="dsurf" title="上下文表面：随流式输出实时增长">⇧' + fmt(d.surfaceTokens || 0) + '</span>'
      var doneNote = allDone ? ' · ✅' : (doneDepts[o.id] ? ' · ✅' + doneDepts[o.id] + '/' + flowDepts[o.id] : '')
      el.innerHTML = (o.id === 'coordinator' ? '🎯 ' : '🏢 ') + (r.title || o.id) + '<small>' + r.model + ' · ' + (r.reasoning || '?') + (calls.length ? ' · 调用×' + calls.length : '') + doneNote + toks + surfs + '</small>'
      el.addEventListener('click', function () { if (justMoved) return; openOrgDept(o.id) })
      el.addEventListener('pointerdown', startDrag)
      el.addEventListener('mouseenter', function (ev) {
        showTip(ev, '<h4>🏢 ' + (r.title || o.id) + '</h4><div style="color:#9ca3af;">模型：' + (r.model || '?') + ' · ' + (r.reasoning || '?') +
          '<br/>聚焦任务调用 ' + calls.length + ' 次 · 部门 token 累计 ' + fmt(d.totalTokens || 0) + ' · 表面 ' + fmt(d.surfaceTokens || 0) +
          '<br/>环节 ' + (doneDepts[o.id] || 0) + '/' + (flowDepts[o.id] || 0) + ' 完结' + (allDone ? '（全部完结 ✅）' : '') + '<br/>点击查看调用记录</div>', el.offsetLeft + el.offsetWidth + 14, el.offsetTop)
      })
      el.addEventListener('mouseleave', window.hideTip)
      cv.appendChild(el)
    })
    renderOrgEdges()
    renderNextEdges()
    renderCallCards()
    renderContractIcons()
  }
  // 下两步交接的特殊连线：橙实线（下一步，流光）/ 橙虚线（第二步），画在部门节点之间
  function renderNextEdges() {
    var svg = $('edges')
    if (!svg) return
    svg.querySelectorAll('.next-edge').forEach(function (el) { el.remove() })
    var deptOf = {}
    ;(STATE.flowNodes || []).forEach(function (n) { deptOf[n.id] = n.dept })
    var pairs = {}
    ;(STATE.nextHandoffs || []).forEach(function (h) {
      var a = deptOf[h.from], b = deptOf[h.to]
      if (!a || !b || a === b) return
      var key = a + '|' + b
      if (pairs[key] === undefined || h.step < pairs[key]) pairs[key] = h.step
    })
    Object.keys(pairs).forEach(function (key) {
      var parts = key.split('|')
      var na = $('nd-dept-' + parts[0]), nb = $('nd-dept-' + parts[1])
      if (!na || !nb) return
      var step = pairs[key]
      var x1 = na.offsetLeft + na.offsetWidth / 2, y1 = na.offsetTop + na.offsetHeight / 2
      var x2 = nb.offsetLeft + nb.offsetWidth / 2, y2 = nb.offsetTop + nb.offsetHeight / 2
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('class', 'next-edge step' + step)
      p.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + ((y1 + y2) / 2) + ' ' + x2 + ',' + ((y1 + y2) / 2) + ' ' + x2 + ',' + y2)
      p.setAttribute('stroke', step === 1 ? '#fb923c' : '#fbbf24')
      p.setAttribute('stroke-width', step === 1 ? '3' : '2.5')
      p.setAttribute('fill', 'none')
      if (step === 2) p.setAttribute('stroke-dasharray', '7 5')
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
      title.textContent = (step === 1 ? '下一步交接' : '第二步交接') + '：' + parts[0] + ' → ' + parts[1]
      p.appendChild(title)
      svg.appendChild(p)
    })
  }
  function renderOrgEdges() {
    var svg = $('edges')
    if (!svg) return
    svg.querySelectorAll('.edge,.docicon,.orge').forEach(function (el) { el.remove() })
    var pos = {}
    ORG.forEach(function (o) {
      var el = $('nd-dept-' + o.id)
      if (el) pos[o.id] = { x: el.offsetLeft + el.offsetWidth / 2, top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight }
    })
    function line(a, b, dash, color) {
      if (!pos[a] || !pos[b]) return
      var y1 = a === 'coordinator' ? pos[a].bottom : pos[a].bottom
      var y2 = pos[b].top
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('class', 'orge')
      p.setAttribute('d', 'M' + pos[a].x + ',' + y1 + ' C' + pos[a].x + ',' + ((y1 + y2) / 2) + ' ' + pos[b].x + ',' + ((y1 + y2) / 2) + ' ' + pos[b].x + ',' + y2)
      p.setAttribute('stroke', color || '#64748b')
      p.setAttribute('stroke-width', '1.5')
      p.setAttribute('fill', 'none')
      if (dash) p.setAttribute('stroke-dasharray', '5 4')
      svg.appendChild(p)
    }
    ;['planner', 'generator', 'qa-runner', 'security-reviewer'].forEach(function (id) { line('coordinator', id, true, '#f59e0b') })
    ORG.forEach(function (o) { if (o.chain) line(o.id, o.chain) })
    line('architect', 'generator')
    line('integrator', 'qa-runner')
    line('sprint-evaluator', 'security-reviewer')
  }
  function renderCallCards() {
    cv.querySelectorAll('.call').forEach(function (el) { el.remove() })
    var fid = STATE.focusTask
    var byDept = {}
    ;(STATE.dispatches || []).forEach(function (d) {
      if (fid && d.taskId !== fid) return
      ;(byDept[d.dept] = byDept[d.dept] || []).push(d)
    })
    Object.keys(byDept).forEach(function (dept) {
      var base = $('nd-dept-' + dept)
      if (!base) return
      var list = byDept[dept]
      var shown = list.slice(-6)
      var overflow = list.length - shown.length
      shown.forEach(function (d, i) {
        var card = document.createElement('div')
        card.className = 'call'
        card.style.cssText = 'left:' + (base.offsetLeft + 4) + 'px;top:' + (base.offsetTop - 18 - i * 16) + 'px;width:' + (base.offsetWidth - 8) + 'px;'
        var task = d.taskId ? d.taskId.replace('TASK-', 'T').replace(/-\d{8}-/, '-') : '?'
        var model = d.model ? d.model.replace('deepseek-v4-', '') : '?'
        card.innerHTML = '<b>' + String(d.at || '').slice(11, 16) + '</b> ' + task + ' · ' + fmtDur(d.durationMs) + '<br/><span>' + model + ' · ⚡' + fmt(d.tokens || 0) + '</span>'
        card.addEventListener('click', function () { if (justMoved) return; openCallDetail(d) })
        cv.appendChild(card)
      })
      if (overflow > 0) {
        var more = document.createElement('div')
        more.className = 'call'
        more.style.cssText = 'left:' + (base.offsetLeft + 4) + 'px;top:' + (base.offsetTop - 18 - shown.length * 16) + 'px;width:' + (base.offsetWidth - 8) + 'px;'
        more.innerHTML = '<b>+' + overflow + '</b> 更早调用…'
        more.addEventListener('click', function () { openOrgDept(dept) })
        cv.appendChild(more)
      }
    })
  }
  // 交接契约：rail 列表 + 组织视图部门连线上的 📄 图标
  function renderContractRows() {
    var list = $('docList')
    if (!list) return
    var contracts = STATE.contracts || []
    if (!contracts.length) {
      if (list.dataset.sig !== 'empty') {
        list.dataset.sig = 'empty'
        list.innerHTML = '<div class="doc-row" style="color:#4b5563;cursor:default;">暂无交接文件（环节派工会生成 📄 交接契约）</div>'
      }
      return
    }
    var sig = contracts.map(function (c) { return c.from + '>' + c.to + (c.signed ? '✓' : '') }).join(',')
    if (list.dataset.sig === sig) return
    list.dataset.sig = sig
    list.innerHTML = ''
    contracts.forEach(function (c) {
      var row = document.createElement('div')
      row.className = 'doc-row'
      row.innerHTML = '📄 ' + c.from + ' → ' + c.to + (c.signed ? ' <span class="ok">✓已签</span>' : ' <span style="color:#f59e0b;">待签</span>')
      row.addEventListener('click', function () { window.openDoc(STATE.focusTask, c.from, c.to) })
      list.appendChild(row)
    })
  }
  function renderContractIcons() {
    cv.querySelectorAll('.cicon').forEach(function (el) { el.remove() })
    var deptOf = {}
    ;(STATE.flowNodes || []).forEach(function (n) { deptOf[n.id] = n.dept })
    ;(STATE.contracts || []).forEach(function (c) {
      var a = deptOf[c.from], b = deptOf[c.to]
      if (!a || !b) return
      var na = $('nd-dept-' + a), nb = $('nd-dept-' + b)
      if (!na || !nb) return
      var x, y
      if (a === b) { x = na.offsetLeft + na.offsetWidth / 2 - 8; y = na.offsetTop - 30 }
      else {
        x = (na.offsetLeft + na.offsetWidth / 2 + nb.offsetLeft + nb.offsetWidth / 2) / 2 - 8
        y = (na.offsetTop + na.offsetHeight / 2 + nb.offsetTop + nb.offsetHeight / 2) / 2 - 8
      }
      var ic = document.createElement('div')
      ic.className = 'cicon'
      ic.style.cssText = 'position:absolute;left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;z-index:6;cursor:pointer;font-size:13px;'
      ic.textContent = c.signed ? '📄' : '📄'
      ic.title = '交接文件：' + c.from + ' → ' + c.to + (c.signed ? '（已签收）' : '（待签）')
      ic.addEventListener('click', function () { window.openDoc(STATE.focusTask, c.from, c.to) })
      cv.appendChild(ic)
    })
  }
  // ================= 变化浮层：数字/内容变化时浮现一张淡出上浮的小卡片 =================
  var prevDeptTokens = {}
  var lastDispatchAt = ''
  function spawnChip(html, x, y) {
    if (!cv) return
    var chip = document.createElement('div')
    chip.className = 'wchip'
    chip.innerHTML = html
    chip.style.left = Math.round(x) + 'px'
    chip.style.top = Math.round(y) + 'px'
    chip.style.opacity = '1'
    cv.appendChild(chip)
    // 下一帧触发 CSS transition：渐隐 + 上浮 46px，2.3s 后移除
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        chip.style.opacity = '0'
        chip.style.top = (Math.round(y) - 46) + 'px'
      })
    })
    setTimeout(function () { if (chip.parentNode) chip.parentNode.removeChild(chip) }, 2300)
  }
  function deptNodeOf(dept) { return $('nd-dept-' + dept) }
  // Token 增长：部门累计用量跨过阈值时浮现「⚡+Δ」
  var prevDeptSurface = {}
  var lastSurfChipAt = {}
  function spawnTokenChips() {
    if (STATE.view !== 'org') return
    Object.keys(STATE.depts || {}).forEach(function (k) {
      var d = STATE.depts[k] || {}
      var total = d.totalTokens || 0
      var prev = prevDeptTokens[k]
      if (prev !== undefined && total > prev) {
        var delta = total - prev
        // 阈值放宽：原 0.5% 相对阈值对百万级部门几乎永不触发（27M × 0.5% = 137k）
        var threshold = Math.max(200, Math.min(5000, Math.round(prev * 0.001)))
        if (delta >= threshold) {
          var el = deptNodeOf(k)
          if (el) spawnChip('<b>⚡ +' + fmt(delta) + '</b> ' + (d.title || k), el.offsetLeft + 8, el.offsetTop - 6)
        }
      }
      prevDeptTokens[k] = total
      // 表面增长浮层：流式生成期间浮现「⇧ +Δ」（8s 冷却/部门，避免每秒刷屏）
      var surf = d.surfaceTokens || 0
      var prevS = prevDeptSurface[k]
      if (prevS !== undefined && surf > prevS) {
        var sDelta = surf - prevS
        var sThreshold = Math.max(200, Math.min(3000, Math.round(prevS * 0.002)))
        var nowT = Date.now()
        if (sDelta >= sThreshold && (!lastSurfChipAt[k] || nowT - lastSurfChipAt[k] > 8000)) {
          lastSurfChipAt[k] = nowT
          var elS = deptNodeOf(k)
          if (elS) spawnChip('<b>⇧ +' + fmt(sDelta) + '</b> ' + (d.title || k), elS.offsetLeft + 8, elS.offsetTop - 6)
        }
      }
      prevDeptSurface[k] = surf
    })
  }
  // 新调用：每次新的部门调用浮现「📞 新调用」
  function spawnNewCallChips(dispatches) {
    if (STATE.view !== 'org') return
    var list = dispatches || []
    var ats = list.map(function (d) { return String(d.at || '') }).filter(Boolean)
    var maxAt = ats.length ? ats[ats.length - 1] : ''
    if (lastDispatchAt && maxAt && maxAt > lastDispatchAt) {
      list.forEach(function (d) {
        if (String(d.at || '') <= lastDispatchAt) return
        var el = deptNodeOf(d.dept)
        if (!el) return
        var task = d.taskId ? d.taskId.replace('TASK-', 'T').replace(/-\d{8}-/, '-') : '?'
        var model = d.model ? d.model.replace('deepseek-v4-', '') : '?'
        spawnChip('📞 新调用 <b>' + String(d.at || '').slice(11, 16) + '</b> ' + task + ' · ' + model + ' · ⚡' + fmt(d.tokens || 0), el.offsetLeft + 8, el.offsetTop - 6)
      })
    }
    lastDispatchAt = maxAt
  }
  // 环节完成：部门节点上浮现「✅ 环节完成」
  function spawnStageChip(stage) {
    if (STATE.view !== 'org') return
    var dept
    ;(STATE.flowNodes || []).forEach(function (n) { if (n.id === stage) dept = n.dept })
    var el = deptNodeOf(dept)
    if (!el) return
    spawnChip('<b>✅ 环节完成</b> ' + stage, el.offsetLeft + 8, el.offsetTop - 6)
  }
  function fmtDur(ms) {
    if (!ms || ms <= 0) return ''
    if (ms < 60000) return Math.round(ms / 1000) + 's'
    if (ms < 3600000) return (ms / 60000).toFixed(1) + 'min'
    return (ms / 3600000).toFixed(1) + 'h'
  }
  function openOrgDept(id) {
    var r = roleOf(id)
    var d = STATE.depts[id] || {}
    var calls = deptCalls(id)
    var recent = calls.slice(-10).reverse()
    fillPanel('<div style="font-weight:700;color:#7dd3fc;padding:6px 10px;">部门抽屉：' + (r.title || id) + '</div>' +
      '<div class="drawer"><div class="k">模型</div>' + (r.model || '?') + ' · ' + (r.reasoning || '?') +
      '<div class="k" style="margin-top:6px;">token</div>累计 ' + fmt(d.totalTokens || 0) + ' · 表面 ' + fmt(d.surfaceTokens || 0) + ' · 排名 ' + (d.rank || '-') +
      '<div class="k" style="margin-top:6px;">调用记录（' + (STATE.focusTask ? '聚焦任务 ' : '全部') + calls.length + ' 次 · 点行看详情）</div>' +
      (recent.length ? recent.map(function (c, i) {
        return '<div data-call-idx="' + i + '" style="padding:3px 0;border-bottom:1px solid #141a26;cursor:pointer;">' + String(c.at || '').slice(11, 19) + ' · ' + (c.taskId || '?') + ' · ' + fmtDur(c.durationMs) + ' · ' + (c.model || '?') + ' · ⚡' + fmt(c.tokens || 0) + '</div>'
      }).join('') : '<div style="color:#6b7280;">暂无调用记录</div>') +
      '</div><div class="btn" style="margin:8px 10px;" onclick="window.__closePanel()">✕ 关闭</div>')
    var drawer = $('rail-drawer')
    if (!drawer) return
    drawer.querySelectorAll('[data-call-idx]').forEach(function (row) {
      row.addEventListener('click', function () { openCallDetail(recent[Number(row.getAttribute('data-call-idx'))]) })
    })
  }
  function openCallDetail(d) {
    if (!d) return
    fillPanel('<div style="font-weight:700;color:#7dd3fc;padding:6px 10px;">📞 调用卡：' + (d.dept || '?') + '</div>' +
      '<div class="drawer">' +
      '<div class="k">时间</div>' + String(d.at || '').replace('T', ' ').slice(0, 19) + (d.durationMs ? ' · 时长 ' + fmtDur(d.durationMs) : '') +
      '<div class="k" style="margin-top:6px;">任务</div>' + (d.taskId || '?') +
      '<div class="k" style="margin-top:6px;">模型</div>' + (d.model || '?') +
      '<div class="k" style="margin-top:6px;">token</div>' + fmt(d.tokens || 0) +
      '<div class="k" style="margin-top:6px;">做了什么</div>' +
      '<div style="white-space:pre-wrap;line-height:1.5;">' + ((d.prompt || '（未记录：旧派工无会话日志）').replace(/</g, '&lt;')) + '</div>' +
      '</div><div class="btn" style="margin:8px 10px;" onclick="window.__closePanel()">✕ 关闭</div>')
  }
  window.__setView = function (v) {
    STATE.view = v === 'flow' ? 'flow' : 'org'
    var o = $('vOrg'), f = $('vFlow')
    if (o) o.className = STATE.view === 'org' ? 'on' : ''
    if (f) f.className = STATE.view === 'flow' ? 'on' : ''
    poll()
  }
  function renderCurrent() {
    if (STATE.view === 'flow') { if (STATE.flow) renderNodes(STATE.flow) } else { renderOrg() }
  }

  // ================= 画布平移：拖空白区域滚动（指针捕获，拖出边界不中断） =================
  var PAN = null
  var scrollWrap = $('canvasScroll')
  if (scrollWrap) {
    scrollWrap.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return
      var t = e.target
      if (t && t.closest && (t.closest('.nd') || t.closest('.call') || t.closest('.btn') || t.closest('input') || t.closest('select'))) return
      e.preventDefault()
      try { scrollWrap.setPointerCapture(e.pointerId) } catch (err) {}
      PAN = { x: e.clientX, y: e.clientY, sx: scrollWrap.scrollLeft, sy: scrollWrap.scrollTop }
      scrollWrap.style.cursor = 'grabbing'
    })
    scrollWrap.addEventListener('pointermove', function (e) {
      if (!PAN) return
      scrollWrap.scrollLeft = PAN.sx - (e.clientX - PAN.x)
      scrollWrap.scrollTop = PAN.sy - (e.clientY - PAN.y)
    })
    function endPan(e) {
      if (!PAN) return
      PAN = null
      scrollWrap.style.cursor = ''
      try { if (e && e.pointerId !== undefined && scrollWrap.releasePointerCapture) scrollWrap.releasePointerCapture(e.pointerId) } catch (err) {}
    }
    scrollWrap.addEventListener('pointerup', endPan)
    scrollWrap.addEventListener('pointercancel', endPan)
  }

  var justMoved = false
  // 节点拖拽用 Pointer Events + setPointerCapture：指针拖出节点/iframe/面板边界后
  // 事件仍持续路由给起始节点（鼠标事件的 iframe 截断问题不再影响拖拽）
  function startDrag(e) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    var el = e.currentTarget
    try { el.setPointerCapture(e.pointerId) } catch (err) {}
    // 关键：指针偏移必须统一在画布坐标系里算（clientX/Y 是视口坐标，
    // offsetLeft/Top 是相对 cv 的坐标，两者相减前要先减 cv 的视口位置，
    // 否则误差等于 cv.top —— 页面头部一高，向下拖都会被钳到顶部）
    var r = cv.getBoundingClientRect()
    DRAG = { el: el, dx: e.clientX - r.left - el.offsetLeft, dy: e.clientY - r.top - el.offsetTop, moved: false, org: el.id.indexOf('nd-dept-') === 0 }
    document.addEventListener('pointermove', onDrag)
    document.addEventListener('pointerup', endDrag)
    document.addEventListener('pointercancel', endDrag)
  }
  function onDrag(e) {
    if (!DRAG) return
    DRAG.moved = true
    var r = cv.getBoundingClientRect()
    DRAG.el.style.left = Math.max(0, Math.min(1300, e.clientX - r.left - DRAG.dx)) + 'px'
    DRAG.el.style.top = Math.max(0, Math.min(500, e.clientY - r.top - DRAG.dy)) + 'px'
    if (DRAG.org) {
      // 组织视图节点：拖动位置写回布局，连线与调用卡跟随
      var id = DRAG.el.id.slice('nd-dept-'.length)
      for (var i = 0; i < ORG.length; i++) {
        if (ORG[i].id === id) { ORG[i].x = DRAG.el.offsetLeft; ORG[i].y = DRAG.el.offsetTop; break }
      }
      renderOrgEdges()
      renderCallCards()
    } else {
      renderEdges(STATE.flow)
    }
  }
  function cancelDrag() {
    DRAG = null
    document.removeEventListener('pointermove', onDrag)
    document.removeEventListener('pointerup', endDrag)
    document.removeEventListener('pointercancel', endDrag)
  }
  function endDrag(e) {
    if (DRAG && DRAG.moved) { justMoved = true; setTimeout(function () { justMoved = false }, 0) }
    try { if (e && e.pointerId !== undefined && DRAG && DRAG.el.releasePointerCapture) DRAG.el.releasePointerCapture(e.pointerId) } catch (err) {}
    DRAG = null
    document.removeEventListener('pointermove', onDrag)
    document.removeEventListener('pointerup', endDrag)
    document.removeEventListener('pointercancel', endDrag)
    // 拖拽期间被挂起的重建（新调用/新 Token 数据）在松手后补齐
    renderCurrent()
  }

  var tok = { cur: 0, target: 0, started: false, lastTick: 0 }
  var tokSamples = []
  // 分批跳动：每 ~260ms 向 target 迈一个可见批（约 32% 剩余量），数字逐批上跳并闪亮，
  // 流式消耗期间每秒都有可见的「跳动」观感（而非平滑缓动或完成时才跳变）。
  function tickTokens() {
    if (tok.started) return
    tok.started = true
    function flash(el, color) {
      if (!el) return
      el.style.color = color
      setTimeout(function () { el.style.color = '#f59e0b' }, 140)
    }
    function step(now) {
      if (!tok.lastTick) tok.lastTick = now
      var diff = tok.target - tok.cur
      if (diff > 0 && now - tok.lastTick >= 260) {
        tok.lastTick = now
        var chunk = Math.max(1, Math.round(diff * 0.32))
        tok.cur = Math.min(tok.target, tok.cur + chunk)
        var v = fmtFull(tok.cur)
        var el = $('tokTotal')
        if (el && el.textContent !== v) { el.textContent = v; flash(el, '#fde68a') }
        var cap = $('capTok')
        if (cap) { var cv = fmt(tok.cur); if (cap.textContent !== cv) cap.textContent = cv }
      } else if (diff < 0 || (diff === 0 && tok.cur !== tok.target)) {
        tok.cur = tok.target
        var v2 = fmtFull(tok.cur)
        var el2 = $('tokTotal'); if (el2 && el2.textContent !== v2) el2.textContent = v2
        var cap2 = $('capTok')
        if (cap2) { var cv2 = fmt(tok.cur); if (cap2.textContent !== cv2) cap2.textContent = cv2 }
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
  tickTokens()

  function pushEvent(ev) {
    var row = document.createElement('div')
    row.className = 'ev'
    row.innerHTML = '<b>' + (ev.ts || '').slice(11, 19) + '</b> ' + ev.type + (ev.stage ? ' · ' + ev.stage : '') + (ev.badges ? ' · ' + ev.badges : '')
    $('evList').insertBefore(row, $('evList').firstChild)
    while ($('evList').children.length > 60) $('evList').lastChild.remove()
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

  function renderChips() {
    var chips = $('chips')
    if (!chips) return
    var sig = STATE.tasks.map(function (t) { return t.taskId + ':' + t.status }).join('|')
    if (chips.dataset.sig === sig) return
    chips.dataset.sig = sig
    chips.innerHTML = ''
    var shown = STATE.tasks.slice(0, 6)
    if (!shown.length) {
      chips.innerHTML = '<span class="chip">暂无任务（对话中 company_start 启动）</span>'
      return
    }
    shown.forEach(function (t) {
      var short = t.taskId.replace('TASK-', '').replace(/\d{8}-/, '')
      var icon = t.status === 'RELEASED' ? '✅ ' : (t.status === 'PAUSED' ? '⏸ ' : (t.status === 'IMPLEMENTING' || t.status === 'QA_RUNNING' ? '⚙ ' : ''))
      var s = document.createElement('span')
      s.className = 'chip' + (STATE.focusTask === t.taskId ? ' on' : '')
      s.textContent = icon + 'TASK-' + short + (t.type ? ' · ' + t.type : '')
      s.style.cursor = 'pointer'
      s.addEventListener('click', function () { window.__selectTask(t.taskId) })
      chips.appendChild(s)
    })
  }

  // ================= 会话级隔离：每个对话框一个 Company =================
  function detectParentSessionTitle() {
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        var sel = window.parent.document.querySelector('.pqeL5W_sessionRow.pqeL5W_selected .pqeL5W_title')
        if (sel && sel.textContent) return sel.textContent.trim()
      }
    } catch (e) {}
    return null
  }
  function scopeQuery() { return STATE.scope ? '&scope=' + encodeURIComponent(STATE.scope) : '' }
  function renderScopeChips() {
    var box = $('scopeChips')
    if (!box) return
    var sig = STATE.scope + '|' + (STATE.sessions || []).map(function (s) { return s.sessionId + ':' + s.title }).join(',')
    if (box.dataset.sig === sig) return
    box.dataset.sig = sig
    box.innerHTML = ''
    function chip(label, val, on) {
      var s = document.createElement('span')
      s.className = 'chip' + (on ? ' on' : '')
      s.textContent = label
      s.style.cursor = 'pointer'
      s.addEventListener('click', function () { window.__selectScope(val) })
      box.appendChild(s)
    }
    chip('🏢 全部', null, STATE.scope === null)
    ;(STATE.sessions || []).forEach(function (s) {
      // sessionId 为 null 的「按目录」伪会话不与 全部 态重复点亮
      chip('📂 ' + (s.title || String(s.sessionId || '').slice(0, 8)) + ' · ' + s.taskCount, s.sessionId, s.sessionId !== null && STATE.scope === s.sessionId)
    })
  }
  // 切换 scope 时重置事件游标（多项目合并流：ts 游标 + project#seq 去重集）
  function resetEventCursor() {
    STATE.since = ''
    STATE.seenKeys = new Set()
    var evl = $('evList'); if (evl) evl.innerHTML = ''
  }
  window.__selectScope = function (id) {
    STATE.scope = id || null
    STATE.scopeChosen = true
    STATE.focusTask = null
    STATE.orgSig = ''; STATE.flowSig = ''; STATE.contracts = []
    resetEventCursor()
    renderChips(); renderScopeChips()
    poll()
  }
  // 父窗口（DSH 侧栏）会话切换：解除手动锁定并跟随新会话；手动选中的 chip
  // 在下次侧栏切换前保持锁定（点击不同会话总是自动切换）。
  var lastParentTitle = detectParentSessionTitle()
  function autoDetectScope(sessions) {
    var title = detectParentSessionTitle()
    if (!title) return false
    if (title !== lastParentTitle) {
      lastParentTitle = title
      STATE.scopeChosen = false // 侧栏点击了别的会话 → 恢复自动跟随
    }
    if (STATE.scopeChosen) return false
    var hit = null
    sessions.forEach(function (s) { if (s.title === title) hit = s.sessionId })
    if (hit && STATE.scope !== hit) {
      STATE.scope = hit
      STATE.focusTask = null
      STATE.orgSig = ''; STATE.flowSig = ''; STATE.contracts = []
      resetEventCursor()
      renderScopeChips()
      return true
    }
    return false
  }

  // ================= 面板（父窗口）即时 scope 切换 =================
  // 面板侧栏自动跟随 / 手动选择都会 postMessage：画布立即切换，不等轮询；
  // auto=false（面板手动选择）保持锁定，auto=true（跟随侧栏）解除锁定。
  window.addEventListener('message', function (ev) {
    if (!ev || !ev.data || ev.data.type !== 'company-scope') return
    if (ev.source !== window.parent) return
    var sid = ev.data.sessionId || null
    if (sid === STATE.scope) return
    STATE.scope = sid
    STATE.scopeChosen = !ev.data.auto
    if (!ev.data.auto) lastParentTitle = detectParentSessionTitle()
    STATE.focusTask = null
    STATE.orgSig = ''; STATE.flowSig = ''; STATE.contracts = []
    resetEventCursor()
    renderChips(); renderScopeChips()
    poll()
  })

  function poll() {
    api('/company-api/events?since=' + encodeURIComponent(STATE.since) + scopeQuery()).then(function (d) {
      (d.events || []).forEach(function (ev) {
        var key = ev._key || ((ev.project || '') + '#' + ev.seq)
        if (STATE.seenKeys.has(key)) return
        STATE.seenKeys.add(key)
        if (STATE.seenKeys.size > 2000) {
          // 修剪最早一半，防无限增长
          var drop = Math.floor(STATE.seenKeys.size / 2)
          var it = STATE.seenKeys.values()
          for (var i = 0; i < drop; i++) STATE.seenKeys.delete(it.next().value)
        }
        if (!STATE.since || ev.ts > STATE.since) STATE.since = ev.ts
        pushEvent(ev)
        // 只把属于当前聚焦任务的环节事件应用到画布（多任务共存时防止串台）；
        // 切换任务时 flow 接口会回填该任务的权威 done/started，跳过的实时事件不丢状态。
        if (ev.taskId && ev.taskId !== STATE.focusTask) return
        if (ev.type === 'stage.started') { STATE.workingStage = ev.stage; STATE.started.add(ev.stage); renderCurrent() }
        if (ev.type === 'stage.done') { STATE.done[ev.stage] = { at: ev.ts }; STATE.workingStage = null; STATE.started.delete(ev.stage); spawnStageChip(ev.stage); renderCurrent() }
        if (ev.type === 'adjudication.started') showAdjNode(ev)
        if (ev.type === 'adjudication.decided') { var a = $('nd-adj'); if (a) a.remove() }
      })
    }).catch(function () {})
    if (!canvasFetchPending) {
      canvasFetchPending = true
      api('/company-api/canvas' + (STATE.scope ? '?scope=' + encodeURIComponent(STATE.scope) : ''), 6000).then(function (d) {
        canvasFetchPending = false
        showEngineDown(false)
      STATE.tasks = d.tasks || []
      STATE.depts = d.depts || {}
      STATE.dispatchDepts = d.dispatchDepts || {}
      STATE.roles = d.roles || []
      STATE.dispatches = d.dispatches || []
      // 变化浮层：Token 增长与新调用各浮现一张淡出卡片
      if (STATE.view === 'org') { spawnTokenChips(); spawnNewCallChips(d.dispatches || []) }
      STATE.concurrency = d.concurrency || 3
      tok.target = d.totalTokens || 0
      // 表面 token 随流式输出实时增长（低延迟观感）
      var surfEl = $('tokSurface')
      if (surfEl) {
        var sv = fmt(d.totalSurface || 0)
        if (surfEl.textContent !== sv) surfEl.textContent = sv
      }
      // 近 1 分钟增量：滚动采样窗口，流式期间每秒可见增长
      var nowMs2 = Date.now()
      tokSamples.push({ t: nowMs2, v: d.totalTokens || 0 })
      while (tokSamples.length && nowMs2 - tokSamples[0].t > 60000) tokSamples.shift()
      var deltaEl = $('tokDelta')
      if (deltaEl) {
        var base = tokSamples[0] ? tokSamples[0].v : (d.totalTokens || 0)
        var dv = (d.totalTokens || 0) - base
        var dtxt = (dv >= 0 ? '+' : '') + fmt(dv)
        if (deltaEl.textContent !== dtxt) deltaEl.textContent = dtxt
        deltaEl.style.color = dv > 0 ? '#86efac' : (dv < 0 ? '#fca5a5' : '#6b7280')
      }
      renderChips()
      // 聚焦任务在画布数据到达后才确定：首个轮询周期的环节事件可能已按上面规则跳过，
      // 由 flow 回填兜底（done/started 均已持久化在 RUN_STATE）。
      var fid = STATE.focusTask || (STATE.tasks[0] && STATE.tasks[0].taskId)
      STATE.focusTask = fid
      if (fid) {
        // 两个视图都拉 flow：流程视图渲染 DAG；组织视图用它做环节→部门映射
        // （部门完结标绿）与交接文件图标定位
        api('/company-api/flow?taskId=' + encodeURIComponent(fid)).then(function (f) {
          if (f.legacy) { STATE.flow = null; STATE.flowNodes = []; return }
          var fsig = fid + '|' + JSON.stringify([f.done, f.started, f.current])
          STATE.flow = f
          STATE.flowNodes = f.nodes || []
          STATE.done = f.done || {}
          STATE.started = new Set(f.started || [])
          STATE.ready = new Set(f.ready || [])
          STATE.current = f.current || null
          if (STATE.workingStage && STATE.started.has(STATE.workingStage) === false) STATE.workingStage = null
          if (STATE.view === 'flow') {
            // 流程快照无变化则不重绘（消除每 2s 轮询重建导致的闪动）
            if (fsig !== STATE.flowSig) { STATE.flowSig = fsig; renderNodes(f) }
          } else {
            renderOrg()
          }
        }).catch(function () {})
        api('/company-api/contracts?taskId=' + encodeURIComponent(fid)).then(function (d) {
          STATE.contracts = (d && d.contracts) || []
          renderContractRows()
          if (STATE.view === 'org') renderOrg()
        }).catch(function () {})
      } else {
        if (STATE.view === 'org') renderOrg()
      }
    }).catch(function (e) {
      canvasFetchPending = false
      var msg = e && e.message ? e.message : ''
      // 超时 = 服务器慢：有数据时保留旧数据静默重试；尚无任何数据时亮「慢」横幅
      if (msg.indexOf('engine-not-mounted') >= 0) showEngineDown(true, 'down')
      else if (msg.indexOf('timeout') >= 0) showEngineDown(STATE.tasks.length === 0 && STATE.roles.length === 0, 'slow')
      else showEngineDown(true, 'slow')
      if (window.console) console.warn('[company-canvas] 数据接口异常：', msg)
    })
    }
    // 会话清单 + 自动识别当前对话框（每个对话框一个 Company）
    api('/company-api/sessions').then(function (d) {
      STATE.sessions = Array.isArray(d) ? d : []
      var changed = autoDetectScope(STATE.sessions)
      renderScopeChips()
      if (changed) poll()
    }).catch(function () {})
  }

  window.__selectTask = function (id) { STATE.focusTask = id; STATE.orgSig = ''; STATE.flowSig = ''; STATE.contracts = []; renderChips(); poll() }

  window.resetLayout = function () { renderCurrent() }

  window.__openCoord = function () {
    fillPanel('<div style="font-weight:700;color:#fbbf24;padding:6px 10px;">🎯 总控 Coordinator（总监）</div>' +
      '<div class="drawer">' +
      '<div class="k">职责</div>派工 · 监督 · 分类/冲突裁决（裁决瞬间升 max，不常驻）' +
      '<div class="k" style="margin-top:6px;">全公司</div>项目 ' + (STATE.tasks ? STATE.tasks.length : 0) + ' 个 · token 总量 ' + fmt(tok.target) + ' · 并发上限 ' + (STATE.concurrency || 3) +
      '<div class="k" style="margin-top:6px;">操作</div>点顶栏滑杆调整并发；点 🔔 审批；点 ⚖ 决策；点「＋ 招聘部门」招聘' +
      '</div><div class="btn" style="margin:8px 10px;" onclick="window.__closePanel()">✕ 关闭</div>')
  }

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

  setInterval(poll, 1000)
  poll()

  window.openDoc = function (taskId, from, to) {
    api('/company-api/contract?taskId=' + encodeURIComponent(taskId || '') + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to))
      .then(function (d) {
        $('modal-card').innerHTML = '<pre style="white-space:pre-wrap;font-size:11px;">' + ((d.markdown || d.error || '暂无').replace(/</g, '&lt;')) + '</pre>' +
          '<div style="margin-top:10px;text-align:right;"><button class="btn" onclick="window.__closeDoc()">关闭</button></div>'
        $('modal').classList.add('on')
      }).catch(function () {})
  }
  window.__closeDoc = function () { $('modal').classList.remove('on') }
  window.closeDoc = window.__closeDoc
})()
