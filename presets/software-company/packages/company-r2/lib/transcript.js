// 子部门（子代理）实时思考/对话转录构建器：
// 把会话事件流（user/message、assistant/message、tool/result、assistant/chunk）
// 折叠成面板可渲染的转录条目 —— 任务要求（user）、每步思考（reasoning）、对话（text）、
// 工具调用（tool-call + 结果）。纯函数、零依赖，可单测。
//
// 事件形态（DSH SessionEventMap，宿主进程内存事件 / 持久日志重放同构）：
//   user/message      data.content: [{type:'text', text}, ...]
//   assistant/message data.message.content: [{type:'reasoning'|'text'|'tool-call', ...}], data.usage
//   tool/call         data.callId / data.name / data.arguments
//   tool/result       data.message.content[0].content: [{type:'text', text}, ...]
//   assistant/chunk   data.chunk: StreamChunk（text-delta / reasoning-delta / tool-call-delta / block-start / block-end / usage / finish）
//   request/context   data.model / data.provider（真实路由）
//   agent/inbox/spliced（宿主自定义）data.inserted: [{content:[{text}]}] —— 父代理追加下发的消息

const MAX_USER_TEXT = 16000
const MAX_BLOCK_TEXT = 20000
const MAX_TOOL_ARGS = 6000
const MAX_TOOL_RESULT = 4000
const MAX_ENTRIES = 500

function cap(text, max) {
  if (text === undefined || text === null) return ''
  const s = String(text)
  if (s.length <= max) return s
  return s.slice(0, max) + '\n…（截断，原始长度 ' + s.length + '）'
}

function textOfContent(content) {
  // content 块数组 → 纯文本（只取 text 块）
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const blk of content) {
    if (blk && blk.type === 'text' && typeof blk.text === 'string') out += blk.text
  }
  return out
}

function userTextOf(ev) {
  if (!ev || !ev.data) return ''
  if (ev.type === 'user/message' && Array.isArray(ev.data.content)) {
    const t = textOfContent(ev.data.content)
    if (t) return t
  }
  if (ev.type === 'agent/inbox/spliced' && Array.isArray(ev.data.inserted)) {
    for (const ins of ev.data.inserted) {
      if (!ins || !Array.isArray(ins.content)) continue
      const t = textOfContent(ins.content)
      if (t) return t
    }
  }
  return ''
}

function modelOfEvents(events) {
  // 最后一条 request/context 优先（真实路由），否则 request/header.config
  let found
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (!e || !e.data) continue
    if (e.type === 'request/context' && e.data.model) {
      found = { provider: String(e.data.provider || ''), model: String(e.data.model) }
      break
    }
  }
  if (found) return found
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e && e.data && e.type === 'request/header' && e.data.header && e.data.header.config && e.data.header.config.model) {
      return { provider: String(e.data.header.config.provider || ''), model: String(e.data.header.config.model) }
    }
  }
  return undefined
}

// 在最后一条 assistant/message 之后用 assistant/chunk 增量组装「正在流式输出」的
// 半成品块 —— 思考/对话边生成边可见，无需等整步完成。
function partialFromChunks(events, lastAssistantIdx) {
  const opens = new Map()
  let turn = null
  let step = null
  for (let i = lastAssistantIdx + 1; i < events.length; i++) {
    const e = events[i]
    if (!e || !e.data) continue
    if (e.type === 'assistant/chunk') {
      const c = e.data.chunk
      if (!c) continue
      if (typeof e.data.turn === 'number') turn = e.data.turn
      if (typeof e.data.step === 'number') step = e.data.step
      const idx = c.index
      if (c.type === 'block-start') {
        opens.set(idx, { t: c.blockType, text: '', name: '', args: '', id: '' })
      } else if (c.type === 'text-delta' || c.type === 'reasoning-delta') {
        const cur = opens.get(idx)
        if (cur && (cur.t === 'text' || cur.t === 'reasoning')) cur.text += c.text || ''
      } else if (c.type === 'tool-call-delta') {
        const cur = opens.get(idx)
        if (cur && cur.t === 'tool-call') {
          if (c.id) cur.id = c.id
          if (c.name) cur.name = c.name
          if (c.argumentsDelta) cur.args += c.argumentsDelta
        }
      } else if (c.type === 'block-end' && c.block) {
        const b = c.block
        opens.set(idx, {
          t: b.type,
          text: b.type === 'text' || b.type === 'reasoning' ? (b.text || '') : '',
          name: b.type === 'tool-call' ? (b.name || '') : '',
          args: b.type === 'tool-call' ? (b.arguments || '') : '',
          id: b.type === 'tool-call' ? String(b.id || '') : '',
        })
      }
    } else if (e.type === 'assistant/message' || e.type === 'turn/end') {
      // 半成品已过期（新消息落地/回合结束）：不再输出 partial
      return undefined
    }
  }
  const blocks = []
  for (const cur of opens.values()) {
    if (cur.t === 'text' || cur.t === 'reasoning') {
      if (cur.text) blocks.push({ t: cur.t, text: cap(cur.text, MAX_BLOCK_TEXT) })
    } else if (cur.t === 'tool-call') {
      if (cur.name || cur.args || cur.id) blocks.push({ t: 'tool', name: cur.name || '…', arguments: cap(cur.args, MAX_TOOL_ARGS), id: cur.id })
    }
  }
  if (blocks.length === 0 && (turn === null || step === null)) return undefined
  return { kind: 'partial', turn, step, blocks, streaming: true }
}

export function buildTranscript(events, opts) {
  const options = opts || {}
  const limit = options.limit || MAX_ENTRIES
  const evs = Array.isArray(events) ? events : []
  // 1) 工具结果索引：callId → { text, isError }
  // callId 有三种落点：data.callId（工具事件）/ data.message.source.callId / content[0].toolCallId
  const results = new Map()
  for (const e of evs) {
    if (!e || !e.data) continue
    if (e.type === 'tool/result') {
      const m = e.data.message
      const inner = m && Array.isArray(m.content) ? m.content : []
      let callId = ''
      if (e.data.callId !== undefined && e.data.callId !== null && e.data.callId !== '') callId = String(e.data.callId)
      else if (m && m.source && m.source.callId) callId = String(m.source.callId)
      else if (inner.length > 0 && inner[0].toolCallId) callId = String(inner[0].toolCallId)
      if (!callId || results.has(callId)) continue
      const blocks = inner.length > 0 && Array.isArray(inner[0].content) ? inner[0].content : []
      const txt = textOfContent(blocks)
      const isErr = !!(e.data.error || (inner[0] && inner[0].isError))
      results.set(callId, isErr
        ? { text: cap(txt, MAX_TOOL_RESULT), isError: true }
        : { text: cap(txt, MAX_TOOL_RESULT) })
    }
  }
  // 2) 主循环：折叠为转录条目
  const entries = []
  let latestSeq = null
  let lastAssistantIdx = -1
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]
    if (!e || !e.data) continue
    if (typeof e.seq === 'number') latestSeq = e.seq
    const time = typeof e.time === 'number' ? e.time : undefined
    if (e.type === 'user/message' || e.type === 'agent/inbox/spliced') {
      const text = userTextOf(e)
      if (!text) continue
      entries.push({ kind: 'user', seq: e.seq, time, text: cap(text, MAX_USER_TEXT), truncated: text.length > MAX_USER_TEXT })
    } else if (e.type === 'assistant/message') {
      lastAssistantIdx = i
      const blocks = []
      for (const b of e.data.message.content || []) {
        if (b.type === 'text' && b.text) blocks.push({ t: 'text', text: cap(b.text, MAX_BLOCK_TEXT) })
        else if (b.type === 'reasoning' && b.text) blocks.push({ t: 'reasoning', text: cap(b.text, MAX_BLOCK_TEXT) })
        else if (b.type === 'tool-call') {
          const r = results.get(String(b.id || ''))
          blocks.push({
            t: 'tool', name: b.name || '?', arguments: cap(b.arguments, MAX_TOOL_ARGS), id: String(b.id || ''),
            result: r ? r.text : undefined, resultError: r ? r.isError : undefined,
          })
        }
      }
      if (blocks.length === 0) continue
      entries.push({
        kind: 'assistant', seq: e.seq, time,
        turn: typeof e.data.turn === 'number' ? e.data.turn : undefined,
        step: typeof e.data.step === 'number' ? e.data.step : undefined,
        blocks,
        usage: e.data.usage || undefined,
      })
    }
  }
  // 3) 正在流式输出的半成品（实时思考/对话）：最后一条完整消息之后仍有 chunk 增量时输出
  const partial = partialFromChunks(evs, lastAssistantIdx)
  // 4) 收尾：只保留最近 limit 条
  const trimmed = entries.length > limit ? entries.slice(entries.length - limit) : entries
  const model = modelOfEvents(evs)
  return {
    entries: trimmed,
    partial,
    latestSeq,
    model: model ? model.model : '',
    provider: model ? model.provider : '',
  }
}
