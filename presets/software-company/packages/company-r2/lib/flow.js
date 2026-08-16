// 纯函数流程模块：DAG 模板 / 校验 / 就绪计算 / 总监调整（全部无 IO，可单测）
export const STAGES_LEGACY = [
  'INTAKE', 'CLASSIFIED', 'DISCOVERY', 'PRODUCT_PLANNED', 'WAITING_INITIAL_APPROVAL',
  'SPRINT_DRAFTING', 'CONTRACT_REVIEW', 'CONTRACT_SIGNED', 'IMPLEMENTING', 'SELF_CHECK',
  'INTEGRATING', 'QA_RUNNING', 'SPRINT_PASSED', 'REPAIRING', 'REPLANNING',
  'FINAL_E2E', 'RELEASED',
]

const N = (id, dept, title, needs) => ({ id, dept, title: title || id, needs: needs || [] })

export const FLOW_TEMPLATES = {
  small: {
    nodes: [
      N('plan', 'planner', '产品规划'),
      N('build', 'generator', '实现'),
      N('verify', 'sprint-evaluator', '确定性门禁', ['build']),
      N('release', 'coordinator', '发布', ['verify']),
    ],
  },
  medium: {
    nodes: [
      N('plan', 'planner', '产品规划'),
      N('explore', 'explorer', '仓库调查'),
      N('build', 'generator', '实现', ['plan', 'explore']),
      N('review', 'sprint-evaluator', '评审', ['build']),
      N('qa', 'qa-runner', 'QA', ['build']),
      N('release', 'coordinator', '发布', ['review', 'qa']),
    ],
  },
  complex: {
    nodes: [
      N('plan', 'planner', '产品规划'),
      N('arch', 'architect', '架构设计', ['plan']),
      N('fe', 'department-generator', '前端部', ['arch']),
      N('be', 'department-generator', '后端部', ['arch']),
      N('data', 'department-generator', '数据部', ['arch']),
      N('integrate', 'integrator', '集成', ['fe', 'be', 'data']),
      N('qa', 'qa-runner', 'QA', ['integrate']),
      N('final', 'final-evaluator', '终验', ['qa']),
      N('release', 'coordinator', '发布', ['final']),
    ],
  },
  'high-risk': {
    nodes: [
      N('plan', 'planner', '产品规划'),
      N('arch', 'architect', '架构设计', ['plan']),
      N('fe', 'department-generator', '前端部', ['arch']),
      N('be', 'department-generator', '后端部', ['arch']),
      N('data', 'department-generator', '数据部', ['arch']),
      N('integrate', 'integrator', '集成', ['fe', 'be', 'data']),
      N('qa', 'qa-runner', 'QA', ['integrate']),
      N('security', 'security-reviewer', '安全评审', ['integrate']),
      N('final', 'final-evaluator', '终验', ['qa', 'security']),
      N('release', 'coordinator', '发布', ['final']),
    ],
  },
}

export function validateFlow(flow) {
  const errs = []
  if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length === 0) return ['nodes 缺失或为空']
  const ids = new Set()
  for (const n of flow.nodes) {
    if (ids.has(n.id)) errs.push('重复节点 id: ' + n.id)
    ids.add(n.id)
  }
  for (const n of flow.nodes) {
    for (const need of n.needs || []) {
      if (!ids.has(need)) errs.push('节点 ' + n.id + ' 依赖不存在的 ' + need)
    }
    if (n.needs && n.needs.includes(n.id)) errs.push('节点 ' + n.id + ' 依赖自身')
  }
  return errs
}

export function readyNodes(flow, done) {
  return flow.nodes
    .filter((n) => !done.has(n.id) && !n.skipped && (n.needs || []).every((x) => done.has(x)))
    .map((n) => n.id)
}

export function adjustFlow(flow, op) {
  const next = structuredClone(flow)
  next.adjustments = (next.adjustments || []).concat([{ op: op.op, at: new Date().toISOString() }])
  if (op.op === 'insert' || op.op === 'addParallel') {
    const anchor = next.nodes.find((n) => n.id === op.after)
    if (!anchor) throw new Error('锚点不存在: ' + op.after)
    const node = { ...op.node, needs: op.op === 'insert' ? [op.after] : (op.after ? [op.after] : []) }
    next.nodes.push(node)
  } else if (op.op === 'skip') {
    const target = next.nodes.find((n) => n.id === op.id)
    if (!target) throw new Error('节点不存在: ' + op.id)
    target.skipped = true
    for (const n of next.nodes) {
      if ((n.needs || []).includes(op.id)) {
        n.needs = n.needs.filter((x) => x !== op.id).concat(target.needs || [])
      }
    }
  } else {
    throw new Error('未知操作: ' + op.op)
  }
  const errs = validateFlow(next)
  if (errs.length) throw new Error('调整后流程非法: ' + errs.join('; '))
  return { flow: next, changed: true }
}
