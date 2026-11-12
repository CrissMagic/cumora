import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DeepSeekTurnTracker } from '../agents/computer/deepseek-stream.js'
import type { EngineHopReport } from '../agents/computer/engine.js'
import { classifyEngineFailure } from '../agents/computer/engine.js'

test('the official headless missing-credential failure requests authentication recovery', () => {
  assert.equal(classifyEngineFailure('dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route'), 'authentication')
})

test('an unfinished or aborted DeepSeek task cannot become a successful wake', () => {
  for (const reason of [undefined, null, { kind: 'aborted' }, { kind: 'error', message: 'quota' }]) {
    const tracker = new DeepSeekTurnTracker(null)
    tracker.observe(JSON.stringify({ type: 'session', sessionId: 'session-one' }))
    if (reason !== undefined) tracker.observe(JSON.stringify({ type: 'final', reason, text: 'partial answer' }))
    assert.ok(tracker.failure())
    assert.equal(tracker.completed, false)
    assert.equal(tracker.sessionId, 'session-one')
  }
})

test('completed tasks retain the exact final answer and session for the next wake', () => {
  const tracker = new DeepSeekTurnTracker(null)
  tracker.observe('a diagnostic line')
  tracker.observe(JSON.stringify({ type: 'text', text: 'truncated preview' }))
  tracker.observe(JSON.stringify({ type: 'final', sessionId: 'opaque-session', reason: { kind: 'completed' }, text: '完整答案 🧪' }))
  assert.equal(tracker.failure(), undefined)
  assert.equal(tracker.text, '完整答案 🧪')
  assert.equal(tracker.sessionId, 'opaque-session')
  assert.equal(tracker.usage, undefined)
})

test('an explicit provider failure is retained even if a later final says completed', () => {
  const tracker = new DeepSeekTurnTracker(null)
  tracker.observe(JSON.stringify({ type: 'error', message: 'invalid api key' }))
  tracker.observe(JSON.stringify({ type: 'final', reason: { kind: 'completed' }, text: '' }))
  assert.equal(tracker.failure(), 'invalid api key')
})

test('per-hop accounting sums disjoint input, output and cache without inventing a model', () => {
  const hops: EngineHopReport[] = []
  const tracker = new DeepSeekTurnTracker(null, (hop) => hops.push(hop))
  for (let i = 0; i < 2; i++) tracker.observe(JSON.stringify({ type: 'status', phase: 'step_end', usage: {
    inputTokens: 10, outputTokens: 5, cacheReadTokens: 30, cacheWriteTokens: 2, reasoningTokens: 3,
  } }))
  assert.deepEqual(tracker.usage, {
    input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 60, cache_creation_input_tokens: 4,
  })
  assert.deepEqual(hops.map((hop) => hop.model), ['deepseek', 'deepseek'])
})

test('missing usage prevents a partial sum from being presented as the turn total', () => {
  const hops: EngineHopReport[] = []
  const tracker = new DeepSeekTurnTracker('local/model', (hop) => hops.push(hop))
  tracker.observe(JSON.stringify({ type: 'status', phase: 'step_end' }))
  tracker.observe(JSON.stringify({ type: 'status', phase: 'step_end', usage: { inputTokens: 3, outputTokens: 1 } }))
  assert.equal(tracker.usage, undefined)
  assert.equal(hops.length, 1)
  assert.equal(hops[0].model, 'local/model')
  assert.equal(hops[0].hopIndex, 2)
})

test('a completed task without a session identity cannot silently lose continuity', () => {
  const tracker = new DeepSeekTurnTracker(null)
  tracker.observe(JSON.stringify({ type: 'final', reason: { kind: 'completed' }, text: 'done' }))
  assert.match(tracker.failure() ?? '', /session identity/)
})

test('a cache bucket omitted on any hop remains unknown in the aggregate', () => {
  const tracker = new DeepSeekTurnTracker(null)
  tracker.observe(JSON.stringify({ type: 'status', phase: 'step_end', usage: { inputTokens: 3, outputTokens: 1 } }))
  tracker.observe(JSON.stringify({ type: 'status', phase: 'step_end', usage: {
    inputTokens: 4, outputTokens: 2, cacheReadTokens: 9,
  } }))
  assert.deepEqual(tracker.usage, { input_tokens: 7, output_tokens: 3 })
})
