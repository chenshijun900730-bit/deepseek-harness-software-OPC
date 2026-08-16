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
      var x = 30 + i * 160
      var y0 = 150 - ((row.length - 1) * 50)
      row.forEach(function (n, j) { pos[n.id] = { x: x, y: y0 + j * 100 } })
    })
    return pos
  }

  function renderNodes(flow) {
    if (!cv) return
    cv.querySelectorAll('.nd').forEach(function (el) { if (el.id !== 'nd-coord') el.remove() })
    var ph = $('nd-placeholder'); if (ph) ph.remove()
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
})()
