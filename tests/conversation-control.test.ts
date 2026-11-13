import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConversationTurnControl } from '../server/src/agents/computer/conversation-control.js'
import { Semaphore } from '../server/src/concurrency.js'

test('pausing one room cancels a shared turn, confirms only after cleanup, and keeps other rooms runnable', () => {
  const control = new ConversationTurnControl()
  const signal = control.begin()
  control.scope(['a', 'b'])
  assert.equal(control.apply([{ conversationId: 'a', paused: true, revision: 1 }]), true)
  assert.equal(signal.aborted, true)
  assert.deepEqual(control.stopped, [])
  control.finish()
  assert.equal(control.stopped.length, 1)
  const next = control.begin()
  control.scope(['b'])
  assert.equal(next.aborted, false)
  assert.deepEqual([...control.paused], ['a'])
})

test('new messages do not resume a paused room; a rapid pause/resume fences the old turn', () => {
  const control = new ConversationTurnControl()
  const old = control.begin()
  control.scope(['a'])
  control.apply([{ conversationId: 'a', paused: false, revision: 2 }])
  assert.equal(old.aborted, true)
  control.finish()
  const next = control.begin()
  control.scope(['a'])
  assert.equal(next.aborted, false)
  assert.deepEqual(control.revisions, { a: 2 })
  control.apply([{ conversationId: 'a', paused: true, revision: 3 }])
  control.finish()
  for (let i = 0; i < 3; i++) {
    const paused = control.begin()
    control.scope(['a'])
    assert.equal(paused.aborted, true)
    control.finish()
  }
})

test('pause arriving during inbox snapshot is caught when scope is installed', () => {
  const control = new ConversationTurnControl()
  const signal = control.begin()
  control.apply([{ conversationId: 'a', paused: true, revision: 1 }])
  control.scope(['a'])
  assert.equal(signal.aborted, true)
})

test('a room injected mid-turn participates in cancellation and reply generation fencing', () => {
  const control = new ConversationTurnControl()
  control.apply([{ conversationId: 'b', paused: false, revision: 2 }])
  const signal = control.begin()
  control.scope(['a'])
  assert.equal(control.include('b'), true)
  assert.deepEqual(control.revisions, { a: 0, b: 2 })
  control.apply([{ conversationId: 'b', paused: true, revision: 3 }])
  assert.equal(signal.aborted, true)
})

test('a late probe from a paused or resumed room cannot cancel another room', () => {
  for (const paused of [true, false]) {
    const control = new ConversationTurnControl()
    const signal = control.begin()
    control.scope(['b'])
    control.apply([{ conversationId: 'a', paused, revision: paused ? 1 : 2 }])
    assert.equal(control.include('a'), false)
    assert.equal(signal.aborted, false)
    if (paused) assert.deepEqual(control.stopped.map((r) => r.conversationId), ['a'])
    assert.equal(control.apply([{ conversationId: 'a', paused: true, revision: 3 }]), false)
    assert.equal(signal.aborted, false)
  }
})

test('cancelling a queued model call removes it without leaking or stealing a permit', async () => {
  const sem = new Semaphore(1)
  await sem.acquire()
  const cancel = new AbortController()
  const cancelled = sem.acquire(cancel.signal)
  const next = sem.acquire()
  cancel.abort(new Error('paused'))
  await assert.rejects(cancelled, /paused/)
  assert.equal(sem.queued, 1)
  sem.release()
  await next
  assert.equal(sem.available, 0)
  sem.release()
  assert.equal(sem.available, 1)
})
