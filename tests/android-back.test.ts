import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dispatchAndroidBack } from '../src/lib/androidBack'
import { navigateMobileBack } from '../src/mobile/navigationBack'

function fixture() {
  const calls: string[] = []
  const state = {
    view: 'conversations' as 'conversations' | 'whispers' | 'agents',
    mobileStack: 'list' as 'list' | 'chat' | 'info',
    infoAgentId: null as string | null,
    openDocumentId: null as string | null,
    openBoardId: null as string | null,
    openCalendarEventId: null as string | null,
    closeAgentInfo: () => { calls.push('participant'); state.infoAgentId = null },
    closeDocumentPeek: () => { calls.push('document'); state.openDocumentId = null },
    closeBoardPeek: () => { calls.push('board'); state.openBoardId = null },
    closeCalendarEventPeek: () => { calls.push('calendar'); state.openCalendarEventId = null },
    pushMobileStack: (stack: 'list' | 'chat' | 'info') => { calls.push(stack); state.mobileStack = stack },
    selectConversation: (id: string | null) => { assert.equal(id, null); calls.push('list'); state.mobileStack = 'list' },
  }
  const whisper = { open: false, close: () => { calls.push('whisper'); whisper.open = false } }
  const target = new EventTarget()
  target.addEventListener('cumora:navigation-back', event => {
    if (navigateMobileBack(state, whisper)) event.preventDefault()
  })
  const back = (canGoBack = false) => dispatchAndroidBack(target, canGoBack, {
    historyBack: () => calls.push('history'), exit: () => calls.push('exit'),
  })
  return { state, whisper, calls, target, back }
}

test('Android Back returns chat info to chat, then list, and exits only at the root', () => {
  const f = fixture()
  f.state.mobileStack = 'info'
  f.back(); assert.deepEqual(f.calls, ['chat'])
  f.back(); assert.deepEqual(f.calls, ['chat', 'list'])
  f.back(); assert.deepEqual(f.calls, ['chat', 'list', 'exit'])
})

test('an open sheet consumes Back before the page even when registered after navigation', () => {
  const f = fixture()
  f.state.mobileStack = 'chat'
  f.target.addEventListener('cumora:hardware-back', event => { event.preventDefault(); f.calls.push('sheet') })
  f.back()
  assert.deepEqual(f.calls, ['sheet'])
  assert.equal(f.state.mobileStack, 'chat')
})

for (const [field, action] of [['infoAgentId', 'participant'], ['openDocumentId', 'document'], ['openBoardId', 'board'], ['openCalendarEventId', 'calendar']] as const) {
  test(`Back closes ${action} before the underlying chat`, () => {
    const f = fixture()
    f.state.mobileStack = 'chat'; f.state[field] = 'open'
    f.back(); assert.deepEqual(f.calls, [action])
    assert.equal(f.state.mobileStack, 'chat')
    f.back(); assert.deepEqual(f.calls, [action, 'list'])
  })
}

test('Back leaves the whisper room and ignores hidden conversation navigation', () => {
  const f = fixture()
  f.state.view = 'whispers'; f.state.mobileStack = 'chat'; f.whisper.open = true
  f.back(); assert.deepEqual(f.calls, ['whisper'])
  assert.equal(f.state.mobileStack, 'chat')
})

test('browser history is a fallback only when neither sheets nor pages handle Back', () => {
  const f = fixture()
  f.state.mobileStack = 'chat'
  f.back(true); assert.deepEqual(f.calls, ['list'])
  f.back(true); assert.deepEqual(f.calls, ['list', 'history'])
})
