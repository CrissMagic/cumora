import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentTemplates, agentTemplateCategories, RECOMMENDED_AGENT_TEMPLATES } from '../shared/agent-templates'

test('a template can create a complete persona without choosing a model or granting an engine permission', () => {
  for (const template of agentTemplates('zh-CN')) {
    assert.ok(template.name.trim() && template.role.trim() && template.bio.trim() && template.systemPrompt.trim())
    assert.ok(!('engine' in template) && !('model' in template) && !('tools' in template))
    const codexAgent = { ...template, computerId: 'pc', engine: 'codex' }
    const dshAgent = { ...template, computerId: 'pc', engine: 'deepseek' }
    assert.equal(codexAgent.systemPrompt, dshAgent.systemPrompt)
  }
})

test('localized template choices preserve role identity and can be customized independently', () => {
  const chinese = agentTemplates('zh-CN')
  const english = agentTemplates('en')
  assert.equal(new Set(chinese.map((entry) => entry.id)).size, chinese.length)
  assert.ok(chinese.length >= 20)
  const categories = new Set(agentTemplateCategories('zh-CN').map((entry) => entry.id))
  assert.ok(chinese.every((entry) => categories.has(entry.category)))
  assert.equal(RECOMMENDED_AGENT_TEMPLATES.length, 6)
  assert.deepEqual(chinese.map((entry) => entry.id), english.map((entry) => entry.id))
  assert.notEqual(chinese[0].name, english[0].name)
  chinese[0].systemPrompt = 'my custom role'
  assert.notEqual(agentTemplates('zh-CN')[0].systemPrompt, 'my custom role')
})
