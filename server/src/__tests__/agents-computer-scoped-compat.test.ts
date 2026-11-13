import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowUnsandboxedByoa, compatibilityEngineIds, engineUsesCompatibilityMode, evaluateRunnableEngines, runnableEngineIds, codexWebSearchMode } from '../agents/computer/engine.js'
import { engineProcessPath } from '../agents/computer/daemon.js'
import { delimiter } from 'node:path'

test('dsh opt-in does not authorize other compatibility engines or unisolate Codex', () => {
  const env = { CUMORA_BYOA_COMPAT_ENGINES: ' deepseek,deepseek,codex,claude,unknown ' }
  assert.deepEqual(compatibilityEngineIds(env), ['deepseek'])
  assert.equal(allowUnsandboxedByoa(env), false)
  assert.equal(engineUsesCompatibilityMode('deepseek', env), true)
  assert.equal(engineUsesCompatibilityMode('codex', env), false)
  assert.equal(engineUsesCompatibilityMode('claude', env), false)
  assert.equal(engineUsesCompatibilityMode('mimo', env), false)
  assert.deepEqual(runnableEngineIds(['claude', 'codex', 'deepseek', 'mimo'], env, 'win32'), ['codex', 'deepseek'])
  assert.equal(engineProcessPath('/agent/bin', '/tools', engineUsesCompatibilityMode('deepseek', env)), `/agent/bin${delimiter}/tools`)
  assert.equal(engineProcessPath('/agent/bin', '/tools', engineUsesCompatibilityMode('codex', env)), '/tools')
})

test('capability evaluation permits scoped dsh and reports a blocked MiMo instead of hiding it', async () => {
  const result = await evaluateRunnableEngines(['deepseek', 'mimo'], { CUMORA_BYOA_COMPAT_ENGINES: 'deepseek' }, 'win32')
  assert.deepEqual(result.runnable, ['deepseek'])
  assert.equal(result.blocked.length, 1)
  assert.equal(result.blocked[0].id, 'mimo')
  assert.match(result.blocked[0].reason, /CUMORA_BYOA_COMPAT_ENGINES=mimo/)
})

test('without opt-in dsh is refused with an actionable reason', async () => {
  const result = await evaluateRunnableEngines(['deepseek'], {}, 'win32')
  assert.deepEqual(result.runnable, [])
  assert.match(result.blocked[0].reason, /local compatibility opt-in/)
})

test('hosted research defaults to live and validates an explicit operator restriction', () => {
  assert.equal(codexWebSearchMode({}), 'live')
  assert.equal(codexWebSearchMode({ CUMORA_CODEX_WEB_SEARCH: 'cached' }), 'cached')
  assert.equal(codexWebSearchMode({ CUMORA_CODEX_WEB_SEARCH: 'disabled' }), 'disabled')
  assert.throws(() => codexWebSearchMode({ CUMORA_CODEX_WEB_SEARCH: 'bogus' }), /must be/)
})
