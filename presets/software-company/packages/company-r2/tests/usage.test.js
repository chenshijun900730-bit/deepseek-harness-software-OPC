import test from 'node:test'
import assert from 'node:assert/strict'
import { attributeUsage, aggregateByDepartment } from '../lib/usage.js'

const dispatches = [
  { sessionId: 's1', taskId: 'T1', department: 'be' },
  { sessionId: 's2', taskId: 'T1', department: 'fe' },
  { sessionId: 's3', taskId: 'T2', department: 'be' },
]
const rows = [
  { id: 's1', totalTokens: 1000 },
  { id: 's2', totalTokens: 400 },
  { id: 's3', totalTokens: 600 },
  { id: 's9', totalTokens: 9999 },
]

test('归属与聚合', () => {
  const attr = attributeUsage(rows, dispatches)
  assert.equal(attr.length, 3)
  const agg = aggregateByDepartment(attr)
  assert.equal(agg.be.totalTokens, 1600)
  assert.equal(agg.fe.totalTokens, 400)
  assert.equal(agg.be.rank, 1)
  assert.equal(agg.fe.rank, 2)
})

test('聚合按任务切片', () => {
  const agg = aggregateByDepartment(attributeUsage(rows, dispatches), 'T2')
  assert.equal(agg.be.totalTokens, 600)
  assert.equal(agg.fe, undefined)
})
