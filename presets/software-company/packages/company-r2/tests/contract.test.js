import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContract, validateContract, signContract, renderContractMarkdown, assertionBadges } from '../lib/contract.js'

test('buildContract 生成三件套并校验', () => {
  const c = buildContract({
    from: 'arch', to: 'fe', modules: ['web/', 'api/', 'data/'],
    apiSignatures: [{ path: 'GET /api/todos', shape: 'Todo[]', owner: 'api' }],
    nonGoals: ['不做用户系统'], assertions: { tests: '4/4', lint: true, coverage: '88%', build: true },
  })
  assert.equal(validateContract(c).length, 0)
  assert.match(renderContractMarkdown(c), /web\//)
  assert.match(renderContractMarkdown(c), /GET \/api\/todos/)
  assert.match(assertionBadges(c.assertions), /✅ 测试 4\/4/)
})

test('validateContract 拒绝缺字段与未知 owner', () => {
  assert.ok(validateContract({}).length > 0)
  const bad = buildContract({ from: 'x', to: 'y', modules: [], apiSignatures: [{ path: 'a', shape: 'b', owner: 'ghost' }], nonGoals: [], assertions: {} })
  assert.equal(validateContract(bad).length, 1)
})

test('signContract 追加签收且不改原对象', () => {
  const c = buildContract({ from: 'arch', to: 'fe', modules: ['a'], apiSignatures: [], nonGoals: [], assertions: {} })
  const signed = signContract(c, 'fe', '2026-08-16T00:00:00Z')
  assert.equal(c.signatures.length, 0)
  assert.equal(signed.signatures.length, 1)
  assert.equal(signed.signatures[0].by, 'fe')
})
