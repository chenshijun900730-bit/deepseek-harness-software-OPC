import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEventsFile, appendEvent, readSince } from '../lib/events.js'

test('追加事件带递增 seq，readSince 增量返回', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'))
  const file = createEventsFile(dir)
  appendEvent(file, { type: 'task.created', taskId: 'T1' })
  appendEvent(file, { type: 'stage.started', taskId: 'T1', stage: 'arch' })
  const all = readSince(file, 0)
  assert.equal(all.length, 2)
  assert.equal(all[0].seq, 1)
  assert.equal(all[1].seq, 2)
  const inc = readSince(file, 1)
  assert.equal(inc.length, 1)
  assert.equal(inc[0].type, 'stage.started')
})

test('空文件读取出空数组', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'))
  const file = createEventsFile(dir)
  assert.deepEqual(readSince(file, 0), [])
})
