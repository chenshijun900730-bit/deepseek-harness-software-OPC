import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOW_TEMPLATES, validateFlow, readyNodes, adjustFlow, STAGES_LEGACY } from '../lib/flow.js'

test('complex 模板含三路并行且汇聚集成', () => {
  const f = FLOW_TEMPLATES.complex
  const ids = f.nodes.map((n) => n.id)
  assert.ok(ids.includes('fe') && ids.includes('be') && ids.includes('data'))
  const inte = f.nodes.find((n) => n.id === 'integrate')
  assert.deepEqual(inte.needs.slice().sort(), ['be', 'data', 'fe'])
})

test('validateFlow 拒绝未知依赖与重复 id', () => {
  assert.equal(validateFlow({ nodes: [{ id: 'a', dept: 'x', needs: ['ghost'] }] }).length, 1)
  assert.equal(validateFlow({ nodes: [{ id: 'a', dept: 'x' }, { id: 'a', dept: 'y' }] }).length, 1)
  assert.equal(validateFlow(FLOW_TEMPLATES.small).length, 0)
})

test('readyNodes 按依赖就绪', () => {
  const f = FLOW_TEMPLATES.complex
  assert.deepEqual(readyNodes(f, new Set(['plan'])), ['arch'])
  assert.deepEqual(readyNodes(f, new Set(['plan', 'arch'])).sort(), ['be', 'data', 'fe'])
  assert.deepEqual(readyNodes(f, new Set(['plan', 'arch', 'fe', 'be', 'data'])), ['integrate'])
})

test('adjustFlow insert 与 skip 留痕', () => {
  let f = adjustFlow(FLOW_TEMPLATES.small, { op: 'insert', after: 'build', node: { id: 'lint', dept: 'qa-runner', title: 'Lint 门禁' } })
  const lint = f.flow.nodes.find((n) => n.id === 'lint')
  assert.deepEqual(lint.needs, ['build'])
  assert.equal(f.flow.adjustments.length, 1)
  f = adjustFlow(f.flow, { op: 'skip', id: 'lint' })
  assert.equal(f.flow.adjustments.length, 2)
  assert.deepEqual(f.flow.adjustments[1].op, 'skip')
})

test('STAGES_LEGACY 17 步用于旧任务回退', () => {
  assert.equal(STAGES_LEGACY.length, 17)
  assert.equal(STAGES_LEGACY[0], 'INTAKE')
  assert.equal(STAGES_LEGACY[STAGES_LEGACY.length - 1], 'RELEASED')
})
