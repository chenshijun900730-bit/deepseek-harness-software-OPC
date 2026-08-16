// 交接契约三件套：模块图 + 类型化 API 签名 + 非目标清单（替代散文 HANDOFF）
const OWNERS = ['web', 'api', 'data', 'integrator', 'generator', 'department-generator']

export function buildContract({ from, to, modules, apiSignatures, nonGoals, assertions }) {
  return {
    version: 1, from, to, issuedAt: new Date().toISOString(),
    modules: modules || [],
    apiSignatures: apiSignatures || [],
    nonGoals: nonGoals || [],
    assertions: assertions || {},
    signatures: [],
  }
}

export function validateContract(c) {
  const errs = []
  if (!c || typeof c !== 'object') return ['contract 缺失']
  if (!c.from || !c.to) errs.push('from/to 必填')
  if (!Array.isArray(c.modules) || !Array.isArray(c.apiSignatures) || !Array.isArray(c.nonGoals)) errs.push('modules/apiSignatures/nonGoals 必须是数组')
  for (const s of c.apiSignatures || []) {
    if (!s.path || !s.shape || !s.owner) errs.push('签名缺字段: ' + JSON.stringify(s))
    else if (!OWNERS.includes(s.owner)) errs.push('未知 owner: ' + s.owner)
  }
  return errs
}

export function signContract(c, by, at) {
  const next = structuredClone(c)
  next.signatures = (next.signatures || []).concat([{ by, at: at || new Date().toISOString() }])
  return next
}

export function renderContractMarkdown(c) {
  const mods = c.modules.map((m) => '- ' + m).join('\n')
  const sigs = c.apiSignatures.map((s) => '- `' + s.path + '` → ' + s.shape + '（owner: ' + s.owner + '）').join('\n')
  const ngs = c.nonGoals.map((n) => '- ' + n).join('\n') || '- （无）'
  const sigLine = (c.signatures || []).map((s) => s.by + ' @ ' + s.at).join('，') || '未签收'
  return [
    '# 交接契约：' + c.from + ' → ' + c.to,
    '签发：' + c.issuedAt + ' · 签收：' + sigLine,
    '## 1. 模块图', '```mermaid', 'graph TD', mods, '```',
    '## 2. 类型化 API 签名', sigs,
    '## 3. 非目标清单', ngs,
    '## 4. 确定性断言', assertionBadges(c.assertions),
  ].join('\n')
}

export function assertionBadges(a) {
  if (!a || Object.keys(a).length === 0) return '（暂无）'
  const parts = []
  if (a.tests) parts.push('✅ 测试 ' + a.tests)
  if (a.lint) parts.push('✅ lint')
  if (a.coverage) parts.push('✅ 覆盖率 ' + a.coverage)
  if (a.build) parts.push('✅ 构建通过')
  return parts.join(' · ') || '（暂无）'
}
