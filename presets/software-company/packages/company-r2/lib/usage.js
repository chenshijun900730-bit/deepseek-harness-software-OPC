// token 归属：tokenMeter 行 × 派工记录 → 部门聚合（估算处由调用方标注）
// surfaceTokens（上下文表面）随流式输出实时增长，供画布/面板低延迟展示。
// 归属规则：
//   1. 有派工记录 → 派工部门（department 缺失时兜底 coordinator，消除「undefined」桶）
//   2. 无派工记录、但属于公司任务主会话（isRoot 且 sessionId 出现在任务归属里）→
//      coordinator 总控：引擎主会话亲自消耗的分类/规划/派工/裁决 token 都算总控。
export function attributeUsage(rows, dispatches, companySessionIds) {
  const bySession = new Map(dispatches.map((d) => [d.sessionId, d]))
  const out = []
  for (const r of rows || []) {
    const d = bySession.get(r.id)
    if (d) {
      out.push({ taskId: d.taskId || null, department: d.department || 'coordinator', totalTokens: r.totalTokens || 0, surfaceTokens: r.surfaceTokens || 0, sessionId: r.id })
    } else if (r.isRoot && companySessionIds && companySessionIds.has(r.id)) {
      out.push({ taskId: null, department: 'coordinator', totalTokens: r.totalTokens || 0, surfaceTokens: r.surfaceTokens || 0, sessionId: r.id })
    }
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
    if (a.taskId) cur.tasks.add(a.taskId)
    map.set(a.department, cur)
  }
  const list = [...map.values()].map((v) => ({ department: v.department, totalTokens: v.totalTokens, surfaceTokens: v.surfaceTokens, tasks: [...v.tasks] }))
  list.sort((x, y) => y.totalTokens - x.totalTokens)
  list.forEach((v, i) => { v.rank = i + 1 })
  return Object.fromEntries(list.map((v) => [v.department, v]))
}
