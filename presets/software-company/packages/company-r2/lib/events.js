// 事件流：单进程追加（host 引擎是唯一写入者），画布按 seq 增量拉取。
// seq 从文件已有记录续接（max+1），服务重启后不重置 —— 否则客户端
// 持有的 seq 卡在高位，新事件（seq 重新从 1 开始）会被 readSince 全部滤掉，
// 画布事件流从此失联（表现为“卡着不动”）。
import fs from 'node:fs'
import path from 'node:path'

export function createEventsFile(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'events.jsonl')
}

const seqCache = new Map() // file -> { mtimeMs, maxSeq }

function nextSeq(file) {
  let max = 0
  try {
    const stat = fs.statSync(file)
    const cached = seqCache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs) max = cached.maxSeq
    else {
      const text = fs.readFileSync(file, 'utf8')
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          const rec = JSON.parse(line)
          if (typeof rec.seq === 'number' && rec.seq > max) max = rec.seq
        } catch { /* 半行写入忽略 */ }
      }
      seqCache.set(file, { mtimeMs: stat.mtimeMs, maxSeq: max })
    }
  } catch { /* 文件不存在：从 1 开始 */ }
  return max + 1
}

export function appendEvent(file, event) {
  const seq = nextSeq(file)
  const rec = { seq, ts: new Date().toISOString(), ...event }
  fs.appendFileSync(file, JSON.stringify(rec) + '\n')
  seqCache.set(file, { mtimeMs: Date.now(), maxSeq: seq })
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
