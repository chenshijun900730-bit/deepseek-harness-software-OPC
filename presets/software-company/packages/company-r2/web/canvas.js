/* 总监大画布数据层：2s 增量拉取事件流 + 快照，前端线性补间渲染。零依赖。 */
(function () {
  'use strict'
  var $ = function (id) { return document.getElementById(id) }
  var cv = $('cv')
  var STATE = { view: 'org', tasks: [], events: [], seq: 0, depts: {}, dispatchDepts: {}, roles: [], dispatches: [], done: {}, started: new Set(), ready: new Set(), current: null, flow: null, focusTask: null, workingStage: null, concurrency: 3, orgSig: '', flowSig: '' }
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
      var x = 30 + i * 160
      var y0 = 150 - ((row.length - 1) * 50)
      row.forEach(function (n, j) { pos[n.id] = { x: x, y: y0 + j * 100 } })
    })
    return pos
  }

  function renderNodes(flow) {
    if (!cv) return
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
    return [STATE.focusTask || '', (STATE.dispatches || []).length, (STATE.roles || []).length, deptsSig].join('|')
  }
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
    })
  }
  function renderOrg() {
    if (!cv) return
    // 数据无变化时不整树重建（消除每 2s 轮询带来的闪动），只原位更新 token 徽标
    var sig = orgSignature()
    if (sig === STATE.orgSig) { updateDeptBadges(); return }
    STATE.orgSig = sig
    cv.querySelectorAll('.nd').forEach(function (el) { if (el.id !== 'nd-coord') el.remove() })
    cv.querySelectorAll('.call').forEach(function (el) { el.remove() })
    var coord = $('nd-coord'); if (coord) coord.style.display = 'none'
    var ph = $('nd-placeholder'); if (ph) ph.remove()
    var names = {}
    ;(STATE.roles || []).forEach(function (r) { names[r.id] = r })
    var nodes = ORG.filter(function (o) { return true })
    nodes.forEach(function (o) {
      var r = roleOf(o.id)
      var calls = deptCalls(o.id)
      var d = STATE.depts[o.id] || {}
      var st = o.id === 'coordinator' ? 'working' : (calls.length ? 'working' : 'idle')
      var s = STATUS_STYLE[st]
      var el = document.createElement('div')
      el.className = 'nd' + (st === 'working' ? ' work' : '')
      el.id = 'nd-dept-' + o.id
      el.style.cssText = 'left:' + o.x + 'px;top:' + o.y + 'px;width:' + o.w + 'px;border-color:' + s.border + ';background:' + s.bg + ';color:' + s.color
      var toks = d.totalTokens ? ' · <span class="dtok">⚡' + fmt(d.totalTokens) + '</span>' : ' · <span class="dtok">⚡0</span>'
      el.innerHTML = (o.id === 'coordinator' ? '🎯 ' : '🏢 ') + (r.title || o.id) + '<small>' + r.model + ' · ' + (r.reasoning || '?') + (calls.length ? ' · 调用×' + calls.length : '') + toks + '</small>'
      el.addEventListener('click', function () { if (justMoved) return; openOrgDept(o.id) })
      el.addEventListener('pointerdown', startDrag)
      el.addEventListener('mouseenter', function (ev) {
        showTip(ev, '<h4>🏢 ' + (r.title || o.id) + '</h4><div style="color:#9ca3af;">模型：' + (r.model || '?') + ' · ' + (r.reasoning || '?') +
          '<br/>聚焦任务调用 ' + calls.length + ' 次 · 部门 token 累计 ' + fmt(d.totalTokens || 0) + '<br/>点击查看调用记录</div>', el.offsetLeft + el.offsetWidth + 14, el.offsetTop)
      })
      el.addEventListener('mouseleave', window.hideTip)
      cv.appendChild(el)
    })
    renderOrgEdges()
    renderCallCards()
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
      '<div class="k" style="margin-top:6px;">token</div>累计 ' + fmt(d.totalTokens || 0) + ' · 排名 ' + (d.rank || '-') +
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
    DRAG = { el: el, dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop, moved: false, org: el.id.indexOf('nd-dept-') === 0 }
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
  function endDrag(e) {
    if (DRAG && DRAG.moved) { justMoved = true; setTimeout(function () { justMoved = false }, 0) }
    try { if (e && e.pointerId !== undefined && DRAG && DRAG.el.releasePointerCapture) DRAG.el.releasePointerCapture(e.pointerId) } catch (err) {}
    DRAG = null
    document.removeEventListener('pointermove', onDrag)
    document.removeEventListener('pointerup', endDrag)
    document.removeEventListener('pointercancel', endDrag)
  }

  var tok = { cur: 0, target: 0, started: false }
  // 常驻缓动循环：向最新 target 平滑趋近；显示值不变时不重写文本（消除无谓的每帧 DOM 写入）
  function tickTokens() {
    if (tok.started) return
    tok.started = true
    function step() {
      var diff = tok.target - tok.cur
      if (Math.abs(diff) < Math.max(10, Math.abs(tok.target) * 0.001)) tok.cur = tok.target
      else tok.cur += diff * 0.06
      var v = fmt(tok.cur)
      var el = $('tokTotal'); if (el && el.textContent !== v) el.textContent = v
      var cap = $('capTok'); if (cap && cap.textContent !== v) cap.textContent = v
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

  function poll() {
    api('/company-api/events?seq=' + STATE.seq).then(function (d) {
      (d.events || []).forEach(function (ev) {
        STATE.seq = ev.seq
        pushEvent(ev)
        // 只把属于当前聚焦任务的环节事件应用到画布（多任务共存时防止串台）；
        // 切换任务时 flow 接口会回填该任务的权威 done/started，跳过的实时事件不丢状态。
        if (ev.taskId && ev.taskId !== STATE.focusTask) return
        if (ev.type === 'stage.started') { STATE.workingStage = ev.stage; STATE.started.add(ev.stage); renderCurrent() }
        if (ev.type === 'stage.done') { STATE.done[ev.stage] = { at: ev.ts }; STATE.workingStage = null; STATE.started.delete(ev.stage); renderCurrent() }
        if (ev.type === 'adjudication.started') showAdjNode(ev)
        if (ev.type === 'adjudication.decided') { var a = $('nd-adj'); if (a) a.remove() }
      })
    }).catch(function () {})
    api('/company-api/canvas').then(function (d) {
      STATE.tasks = d.tasks || []
      STATE.depts = d.depts || {}
      STATE.dispatchDepts = d.dispatchDepts || {}
      STATE.roles = d.roles || []
      STATE.dispatches = d.dispatches || []
      STATE.concurrency = d.concurrency || 3
      tok.target = d.totalTokens || 0
      renderChips()
      // 聚焦任务在画布数据到达后才确定：首个轮询周期的环节事件可能已按上面规则跳过，
      // 由 flow 回填兜底（done/started 均已持久化在 RUN_STATE）。
      var fid = STATE.focusTask || (STATE.tasks[0] && STATE.tasks[0].taskId)
      STATE.focusTask = fid
      if (STATE.view === 'flow' && fid) {
        api('/company-api/flow?taskId=' + encodeURIComponent(fid)).then(function (f) {
          if (f.legacy) { STATE.flow = null; renderNodes(null); return }
          var fsig = fid + '|' + JSON.stringify([f.done, f.started, f.current])
          STATE.flow = f
          STATE.done = f.done || {}
          STATE.started = new Set(f.started || [])
          STATE.ready = new Set(f.ready || [])
          STATE.current = f.current || null
          if (STATE.workingStage && STATE.started.has(STATE.workingStage) === false) STATE.workingStage = null
          // 流程快照无变化则不重绘（消除每 2s 轮询重建导致的闪动）
          if (fsig !== STATE.flowSig) { STATE.flowSig = fsig; renderNodes(f) }
        }).catch(function () {})
      } else {
        renderOrg()
      }
    }).catch(function () {})
  }

  window.__selectTask = function (id) { STATE.focusTask = id; STATE.orgSig = ''; STATE.flowSig = ''; renderChips(); poll() }

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

  setInterval(poll, 2000)
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
