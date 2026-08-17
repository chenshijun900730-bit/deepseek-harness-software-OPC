import test from 'node:test'
import assert from 'node:assert/strict'
import { filterAttributedByScope, everCallCountsOf, sumTokens } from '../lib/usage.js'

const attributed = [
  { taskId: 'T1', project: '/p1', department: 'be', sessionId: 's-be', totalTokens: 1000 },
  { taskId: 'T2', project: '/p2', department: 'fe', sessionId: 's-fe', totalTokens: 400 },
  { taskId: null, department: 'coordinator', sessionId: 's-root', totalTokens: 600 },
  { taskId: null, department: 'coordinator', sessionId: 's-other', totalTokens: 9999 },
]

test('filterAttributedByScope 命中子代理行与归属主会话行', () => {
  const out = filterAttributedByScope(attributed, new Set(['/p1\u0000T1']), new Set(['s-root']))
  assert.equal(out.length, 2)
  assert.equal(out[0].department, 'be')
  assert.equal(out[1].sessionId, 's-root')
})

test('filterAttributedByScope 排除其他任务与其他主会话', () => {
  const out = filterAttributedByScope(attributed, new Set(['/p1\u0000T1']), new Set(['s-root']))
  assert.ok(!out.some((a) => a.taskId === 'T2' || a.sessionId === 's-other'))
})

test('everCallCountsOf 统计调用次数与部门列表', () => {
  const { counts, depts } = everCallCountsOf([
    { department: 'be' }, { department: 'be' }, { department: 'fe' }, { department: null }, {},
  ])
  assert.deepEqual(counts, { be: 2, fe: 1 })
  assert.deepEqual(depts.sort(), ['be', 'fe'])
})

test('sumTokens 合计归属行 token', () => {
  assert.equal(sumTokens(attributed), 11999)
})
