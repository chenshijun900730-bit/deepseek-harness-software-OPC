import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTranscript } from '../lib/transcript.js'

function ev(type, data, seq, time) {
  const e = { type, seq, time }
  if (data !== undefined) e.data = data
  return e
}

test('折叠 user/assistant/reasoning/tool-call 为转录条目并附工具结果', () => {
  const events = [
    ev('user/message', { content: [{ type: 'text', text: '你是「主程序员 Generator」…实现登录页（任务 TASK-20260818-001）' }] }, 1, 100),
    ev('assistant/message', {
      turn: 0, step: 0,
      message: { content: [
        { type: 'reasoning', text: '先读现有代码结构。' },
        { type: 'text', text: '我先看一下项目结构。' },
        { type: 'tool-call', id: 'call-1', name: 'glob', arguments: '{"pattern":"**/*.tsx"}' },
      ] },
      usage: { inputTokens: 100, outputTokens: 20 },
    }, 2, 200),
    ev('tool/result', { callId: 'call-1', message: { content: [{ content: [{ type: 'text', text: 'a.tsx\nb.tsx' }] }] } }, 3, 300),
    ev('assistant/message', { turn: 0, step: 1, message: { content: [{ type: 'text', text: '开始实现。' }] } }, 4, 400),
  ]
  const t = buildTranscript(events)
  assert.equal(t.entries.length, 3)
  assert.equal(t.entries[0].kind, 'user')
  assert.ok(t.entries[0].text.includes('主程序员 Generator'))
  const a = t.entries[1]
  assert.equal(a.kind, 'assistant')
  assert.equal(a.blocks.length, 3)
  assert.equal(a.blocks[0].t, 'reasoning')
  assert.equal(a.blocks[1].t, 'text')
  assert.equal(a.blocks[2].t, 'tool')
  assert.equal(a.blocks[2].name, 'glob')
  assert.equal(a.blocks[2].result, 'a.tsx\nb.tsx')
  assert.equal(a.blocks[2].resultError, undefined)
  assert.equal(t.entries[2].step, 1)
  assert.equal(t.latestSeq, 4)
  assert.equal(t.partial, undefined)
})

test('最后一条消息之后的 chunk 增量组装为流式 partial（思考边生成边可见）', () => {
  const events = [
    ev('user/message', { content: [{ type: 'text', text: '写一个工具函数' }] }, 1, 100),
    ev('assistant/message', { turn: 0, step: 0, message: { content: [{ type: 'text', text: '开始。' }] } }, 2, 200),
    ev('assistant/chunk', { turn: 0, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } }, 3, 300),
    ev('assistant/chunk', { turn: 0, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '这个函数需要' } }, 4, 301),
    ev('assistant/chunk', { turn: 0, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '处理空输入。' } }, 5, 302),
  ]
  const t = buildTranscript(events)
  assert.equal(t.entries.length, 2)
  assert.ok(t.partial)
  assert.equal(t.partial.kind, 'partial')
  assert.equal(t.partial.streaming, true)
  assert.equal(t.partial.blocks.length, 1)
  assert.equal(t.partial.blocks[0].t, 'reasoning')
  assert.equal(t.partial.blocks[0].text, '这个函数需要处理空输入。')
})

test('回合结束后不再输出 stale partial', () => {
  const events = [
    ev('user/message', { content: [{ type: 'text', text: 'x' }] }, 1, 100),
    ev('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '部分' } }, 2, 200),
    ev('turn/end', { turn: 0, reason: 'completed' }, 3, 300),
  ]
  const t = buildTranscript(events)
  assert.equal(t.partial, undefined)
})

test('超长文本截断并标注', () => {
  const long = '长'.repeat(30000)
  const events = [
    ev('user/message', { content: [{ type: 'text', text: long }] }, 1, 100),
    ev('assistant/message', { turn: 0, step: 0, message: { content: [{ type: 'reasoning', text: long }] } }, 2, 200),
  ]
  const t = buildTranscript(events)
  assert.equal(t.entries[0].truncated, true)
  assert.ok(t.entries[0].text.length < long.length)
  assert.ok(t.entries[0].text.includes('截断'))
  assert.ok(t.entries[1].blocks[0].text.includes('截断'))
})

test('从 request/context 解析真实模型路由', () => {
  const events = [
    ev('user/message', { content: [{ type: 'text', text: 'hi' }] }, 1, 100),
    ev('request/context', { provider: 'deepseek-official', model: 'deepseek-v4-pro', reason: 'route' }, 2, 200),
    ev('assistant/message', { turn: 0, step: 0, message: { content: [{ type: 'text', text: 'ok' }] } }, 3, 300),
  ]
  const t = buildTranscript(events)
  assert.equal(t.model, 'deepseek-v4-pro')
  assert.equal(t.provider, 'deepseek-official')
})

test('空事件与无消息事件返回空转录', () => {
  assert.equal(buildTranscript(undefined).entries.length, 0)
  assert.equal(buildTranscript([{ type: 'turn/start', seq: 1, time: 1, data: { turn: 0 } }]).entries.length, 0)
})

test('工具结果 callId 取 message.source.callId（真实持久日志形态）', () => {
  const events = [
    ev('user/message', { content: [{ type: 'text', text: 'go' }] }, 1, 100),
    ev('assistant/message', { turn: 0, step: 0, message: { content: [{ type: 'tool-call', id: 'call_00_abc', name: 'bash', arguments: '{"command":"ls"}' }] } }, 2, 200),
    ev('tool/result', {
      message: {
        source: { kind: 'tool', callId: 'call_00_abc' },
        content: [{ type: 'tool-result', toolCallId: 'call_00_abc', content: [{ type: 'text', text: 'a.txt\nb.txt' }] }],
      },
    }, 3, 300),
  ]
  const t = buildTranscript(events)
  assert.equal(t.entries[1].blocks[0].result, 'a.txt\nb.txt')
})

test('条目超限时保留最近 limit 条', () => {
  const events = []
  for (let i = 0; i < 30; i++) {
    events.push(ev('user/message', { content: [{ type: 'text', text: 'm' + i }] }, i * 2 + 1, i))
    events.push(ev('assistant/message', { turn: 0, step: i, message: { content: [{ type: 'text', text: 'r' + i }] } }, i * 2 + 2, i + 0.5))
  }
  const t = buildTranscript(events, { limit: 10 })
  assert.equal(t.entries.length, 10)
  assert.equal(t.entries[0].text, 'm25')
  assert.equal(t.entries[9].blocks[0].text, 'r29')
})
