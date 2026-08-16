// 事件流：单进程追加（host 引擎是唯一写入者），画布按 seq 增量拉取
import fs from 'node:fs'
import path from 'node:path'

export function createEventsFile(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'events.jsonl')
}

let seqCounter = 0

export function appendEvent(file, event) {
  seqCounter += 1
  const rec = { seq: seqCounter, ts: new Date().toISOString(), ...event }
  fs.appendFileSync(file, JSON.stringify(rec) + '\n')
  return rec
}

export function readSince(file, afterSeq) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line)
      if (rec.seq > afterSeq) out.push(rec)
    } catch { /* 半行写入忽略 */ }
  }
  return out
}
