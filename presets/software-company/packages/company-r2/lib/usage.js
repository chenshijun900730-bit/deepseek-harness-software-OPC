// token 归属：tokenMeter 行 × 派工记录 → 部门聚合（估算处由调用方标注）
// surfaceTokens（上下文表面）随流式输出实时增长，供画布/面板低延迟展示。
export function attributeUsage(rows, dispatches) {
  const bySession = new Map(dispatches.map((d) => [d.sessionId, d]))
  const out = []
  for (const r of rows || []) {
    const d = bySession.get(r.id)
    if (!d) continue
    out.push({ taskId: d.taskId, department: d.department, totalTokens: r.totalTokens || 0, surfaceTokens: r.surfaceTokens || 0, sessionId: r.id })
  }
  return out
}

export function aggregateByDepartment(attributed, taskId) {
  const map = new Map()
  for (const a of attributed || []) {
    if (taskId && a.taskId !== taskId) continue
    const cur = map.get(a.department) || { department: a.department, totalTokens: 0, surfaceTokens: 0, tasks: new Set() }
    cur.totalTokens += a.totalTokens
    cur.surfaceTokens += a.surfaceTokens || 0
    cur.tasks.add(a.taskId)
    map.set(a.department, cur)
  }
  const list = [...map.values()].map((v) => ({ department: v.department, totalTokens: v.totalTokens, surfaceTokens: v.surfaceTokens, tasks: [...v.tasks] }))
  list.sort((x, y) => y.totalTokens - x.totalTokens)
  list.forEach((v, i) => { v.rank = i + 1 })
  return Object.fromEntries(list.map((v) => [v.department, v]))
}
