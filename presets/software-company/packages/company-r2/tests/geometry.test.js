import test from 'node:test'
import assert from 'node:assert/strict'
import { lerp, straightMid, cubicMid, edgePath } from '../lib/geometry.js'

test('lerp 线性插值', () => {
  assert.equal(lerp(0, 100, 0.5), 50)
  assert.equal(lerp(10, 20, 0), 10)
})

test('cubicMid t=0.5 加权中点', () => {
  const m = cubicMid({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, 0.5)
  assert.equal(m.x, 5)
  assert.equal(m.y, 7.5)
})

test('edgePath 直线与贝塞尔', () => {
  assert.match(edgePath(0, 0, 100, 0, {}), /^M0,0 L100,0$/)
  assert.match(edgePath(0, 0, 100, 200, {}), /^M0,0 C/)
  assert.match(edgePath(0, 100, 50, 0, { hub: true }), /^M0,100 C/)
})

test('straightMid', () => {
  assert.deepEqual(straightMid({ x: 0, y: 0 }, { x: 10, y: 10 }), { x: 5, y: 5 })
})
