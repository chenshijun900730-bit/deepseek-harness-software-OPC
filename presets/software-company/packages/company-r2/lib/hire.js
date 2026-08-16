// 招聘/改造：校验、preset 文本生成、roles 合并与撤销（纯函数，无 IO）
export const DEPT_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/
export const VALID_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash']
export const VALID_REASONING = ['low', 'medium', 'high']
export const TOOL_ROWS = {
  bash: '- id: tool-bash\n  name: \'@deepseek-ai/dsh-tool-bash\'\n',
  fs: '- id: tool-fs\n  name: \'@deepseek-ai/dsh-tool-fs\'\n',
  search: '- id: tool-fs-search\n  name: \'@deepseek-ai/dsh-tool-fs-search\'\n',
  jobs: '- id: tool-jobs\n  name: \'@deepseek-ai/dsh-tool-jobs\'\n',
  subagent: '- id: tool-subagent\n  name: \'@deepseek-ai/dsh-tool-subagent\'\n  config:\n    provider: spawn\n    toolName: subagent\n    backgroundMode: continuable\n',
  web: '- id: tool-web\n  name: \'@deepseek-ai/dsh-tool-web\'\n  config:\n    fetch: false\n',
  ask: '- id: tool-ask-user\n  name: \'@deepseek-ai/dsh-tool-ask-user\'\n',
  todo: '- id: tool-todo\n  name: \'@deepseek-ai/dsh-tool-todo\'\n',
}

export function validateHire({ id, title, persona, model, reasoning, tools }) {
  const errs = []
  if (!DEPT_ID_RE.test(id || '')) errs.push('id 需匹配 [a-z0-9-]{2,32}')
  if (!title || !persona) errs.push('title/persona 必填')
  if (!VALID_MODELS.includes(model)) errs.push('model 必须 ' + VALID_MODELS.join('/'))
  if (!VALID_REASONING.includes(reasoning)) errs.push('reasoning 必须 ' + VALID_REASONING.join('/'))
  if (!Array.isArray(tools) || tools.some((t) => !TOOL_ROWS[t])) errs.push('tools 含未知项')
  return errs
}

export function renderDeptPresetYml({ id, title, persona, model, reasoning, tools }) {
  const toolRows = (tools || []).map((t) => TOOL_ROWS[t]).join('')
  return [
    '- id: persona',
    '  name: \'@deepseek-ai/dsh-persona\'',
    '  config:',
    '    text: >-',
    '      你是「' + title + '」部门（company-dept-' + id + '）的执行者。' + persona,
    '- id: agent-instructions',
    '  name: \'@deepseek-ai/dsh-agent-instructions\'',
    '  config:',
    '    maxBytes: 65536',
    toolRows,
  ].join('\n') + '\n'
}

export function mergeRole(roles, newRole) {
  if (roles.some((r) => r.id === newRole.id)) throw new Error('角色 id 已存在（标准角色不可覆盖）: ' + newRole.id)
  return roles.concat([{ ...newRole, source: 'hired' }])
}

export function undoRole(roles, id) {
  const target = roles.find((r) => r.id === id)
  if (!target) throw new Error('角色不存在: ' + id)
  if (target.source !== 'hired') throw new Error('标准角色不可撤销: ' + id)
  return roles.filter((r) => r.id !== id)
}
