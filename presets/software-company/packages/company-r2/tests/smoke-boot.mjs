#!/usr/bin/env node
/* 冒烟：画布出厂动效 + 空态/横幅。用法：node tests/smoke-boot.mjs <画布URL> [scopeSessionId]
 * 校验：0.5s 内 boot 覆盖层可见且无部门卡；3.7s 后覆盖层消失；
 *       之后进入三种合法终态之一：空态提示 / 14 张部门底卡 / 引擎未挂载横幅；
 *       传 scopeSessionId 时额外校验任务 chip 非空或空态提示。
 * 依赖：系统 Chrome（--no-sandbox，宿主沙箱环境必须）；Node >= 22（原生 WebSocket）。
 */
import { spawn } from 'node:child_process'
import http from 'node:http'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9340
const PROFILE = '/tmp/smoke-boot-profile'
const PAGE_URL = process.argv[2]
const SCOPE = process.argv[3] || ''
if (!PAGE_URL) { console.error('usage: node tests/smoke-boot.mjs <url> [scopeSessionId]'); process.exit(2) }

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
const page = PAGE_URL + (SCOPE ? (PAGE_URL.indexOf('?') >= 0 ? '&' : '?') + 'scope=' + encodeURIComponent(SCOPE) : '')
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
  const banner = document.getElementById('engineBanner')
  const cards = document.querySelectorAll('.nd[id^="nd-dept-"]').length
  const chips = document.querySelectorAll('#chips .chip').length
  return { empty: !!(eh && eh.style.display === 'block'), banner: !!(banner && banner.style.display === 'block'),
           cards, chips,
           chipTexts: Array.from(document.querySelectorAll('#chips .chip')).map(c => c.textContent).slice(0, 8) }
})()`)
if (SCOPE) {
  check('指定 scope 后出现任务 chip（或空态提示）', state.chips > 0 || state.empty, JSON.stringify(state.chipTexts))
} else {
  check('终态合法：空态提示 / 14 张部门底卡 / 引擎未挂载横幅', state.empty || state.cards === 14 || state.banner, 'empty=' + state.empty + ' cards=' + state.cards + ' banner=' + state.banner)
}
kill()
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? ('SMOKE FAILED: ' + failed.map((f) => f.name).join('; ')) : 'SMOKE PASSED')
process.exit(failed.length ? 1 : 0)
