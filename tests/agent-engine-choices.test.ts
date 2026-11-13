import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentEngineChoices } from '../src/lib/agent-engine-choices'

test('installed dsh is visible with its refusal while Codex stays selectable', () => {
  const rows = agentEngineChoices({ availableEngines: ['codex'], detectedEngines: [
    { id: 'deepseek', bin: 'dsh', path: 'C:/bin/dsh.cmd', blockedReason: 'local permission required' },
  ] })
  assert.equal(rows.find((row) => row.id === 'codex')?.runnable, true)
  assert.deepEqual(rows.find((row) => row.id === 'deepseek'), {
    id: 'deepseek', detected: true, runnable: false, reason: 'local permission required',
  })
  assert.equal(rows.find((row) => row.id === 'mimo')?.detected, false)
  assert.equal(rows.find((row) => row.id === 'mimo')?.runnable, false)
  assert.deepEqual(rows.slice(0, 2).map((row) => row.id), ['codex', 'deepseek'])
})

test('a new inventory makes dsh assignable and an empty inventory offers no fallback', () => {
  assert.equal(agentEngineChoices({ availableEngines: ['deepseek'], detectedEngines: [] })
    .find((row) => row.id === 'deepseek')?.runnable, true)
  assert.ok(agentEngineChoices({ availableEngines: [], detectedEngines: [] }).every((row) => !row.runnable))
})
