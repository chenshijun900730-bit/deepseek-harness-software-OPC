import test from 'node:test'
import assert from 'node:assert/strict'
import { DEPT_ID_RE, validateHire, renderDeptPresetYml, mergeRole, undoRole } from '../lib/hire.js'

const STD = [{ id: 'generator', title: 'Generator', model: 'deepseek-v4-pro', reasoning: 'high' }]

test('validateHire 校验 id/模型/工具', () => {
  assert.equal(validateHire({ id: 'qa-auto', title: '自动化测试部', persona: '跑测试', model: 'deepseek-v4-flash', reasoning: 'medium', tools: ['bash'] }).length, 0)
  assert.ok(validateHire({ id: 'UPPER!!', title: 'x', persona: 'p', model: 'nope', reasoning: 'medium', tools: [] }).length >= 2)
})

test('renderDeptPresetYml 按工具集生成 preset 文本', () => {
  const yml = renderDeptPresetYml({ id: 'qa-auto', title: '自动化测试部', persona: '跑测试', model: 'deepseek-v4-flash', reasoning: 'medium', tools: ['bash', 'fs'] })
  assert.match(yml, /id: persona/)
  assert.match(yml, /id: tool-bash/)
  assert.match(yml, /id: tool-fs/)
  assert.doesNotMatch(yml, /id: tool-web/)
})

test('mergeRole 不得覆盖标准角色，undoRole 移除', () => {
  assert.throws(() => mergeRole(STD, { id: 'generator', title: 'x' }))
  const next = mergeRole(STD, { id: 'qa-auto', title: '自动化测试部' })
  assert.equal(next.length, 2)
  const back = undoRole(next, 'qa-auto')
  assert.equal(back.length, 1)
  assert.throws(() => undoRole(back, 'generator'))
})
