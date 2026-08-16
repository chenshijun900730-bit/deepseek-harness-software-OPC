// 连线/补间数学：浏览器画布与 Node 单测共用同一实现
export function lerp(a, b, t) { return a + (b - a) * t }

export function straightMid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }

export function cubicMid(p0, p1, p2, p3, t) {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

export function edgePath(x1, y1, x2, y2, { hub = false, down = false } = {}) {
  if (Math.abs(y2 - y1) < 30 && !hub && !down) return 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2
  const dx = Math.max(40, Math.abs(x2 - x1) / 2)
  const c1x = hub ? x1 : x1 + dx
  const c2x = hub ? x2 : x2 - dx
  return 'M' + x1 + ',' + y1 + ' C' + c1x + ',' + y1 + ' ' + c2x + ',' + y2 + ' ' + x2 + ',' + y2
}

if (typeof window !== 'undefined') window.Geometry = { lerp: lerp, straightMid: straightMid, cubicMid: cubicMid, edgePath: edgePath }
