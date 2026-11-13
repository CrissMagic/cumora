import test from 'node:test'
import assert from 'node:assert/strict'
import { checkServerAddress, needsServerAddress, normalizeServerAddress, resolveServerAddress, saveServerAddress, SERVER_ADDRESS_KEY } from '../src/lib/server-address'

test('normalizes service origins and rejects ambiguous or credential-bearing URLs', () => {
  assert.equal(normalizeServerAddress(' https://EXAMPLE.com:443/ '), 'https://example.com')
  assert.equal(normalizeServerAddress('http://192.168.1.10:5181'), 'http://192.168.1.10:5181')
  for (const address of ['', 'example.com', 'file:///tmp', 'https://example.com/api', 'https://user:pass@example.com', 'https://example.com/?token=secret', 'https://example.com/#auth']) {
    assert.throws(() => normalizeServerAddress(address), undefined, address)
  }
})

test('keeps saved selection across upgrades and does not silently fall back for invalid saved choices', () => {
  assert.equal(resolveServerAddress('https://mine.example/', 'https://other.example'), 'https://mine.example')
  assert.equal(resolveServerAddress('bad', 'https://other.example'), '')
  assert.equal(resolveServerAddress('', 'https://other.example'), '')
  assert.equal(resolveServerAddress(null, 'https://other.example'), 'https://other.example')
  assert.equal(resolveServerAddress(null, ''), '')
})

test('requires setup only for an unconfigured production desktop', () => {
  assert.equal(needsServerAddress(true, false, ''), true)
  assert.equal(needsServerAddress(true, true, ''), false)
  assert.equal(needsServerAddress(false, false, ''), false)
  assert.equal(needsServerAddress(true, false, 'https://mine.example'), false)
})

test('server switch persists origin and clears the old session; invalid input leaves both unchanged', () => {
  const values = new Map<string, string>()
  let cleared = 0
  const storage = { setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const clear = () => { cleared++ }
  saveServerAddress(storage, 'https://mine.example/', clear)
  assert.equal(values.get(SERVER_ADDRESS_KEY), 'https://mine.example')
  assert.equal(cleared, 1)
  assert.throws(() => saveServerAddress(storage, 'https://other.example/api', clear))
  assert.equal(values.get(SERVER_ADDRESS_KEY), 'https://mine.example')
  assert.equal(cleared, 1)
  saveServerAddress(storage, null, clear)
  assert.equal(values.has(SERVER_ADDRESS_KEY), false)
  assert.equal(cleared, 2)
})

test('health check uses an unauthenticated bounded request without following redirects', async () => {
  let called = false
  const origin = await checkServerAddress('https://mine.example/', async (input, init) => {
    called = true
    assert.equal(input, 'https://mine.example/api/health')
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.headers, undefined)
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.referrerPolicy, 'no-referrer')
    assert.ok(init?.signal instanceof AbortSignal)
    assert.equal(init.signal.aborted, false)
    return Response.json({ ok: true, ts: Date.now() })
  })
  assert.equal(called, true)
  assert.equal(origin, 'https://mine.example')
})

test('health check rejects non-Cumora responses, service failures, network failures and aborted requests', async () => {
  for (const response of [Response.json({ ok: false }), Response.json({ status: 'up' }), new Response('<html>login</html>'), Response.json({ ok: true }, { status: 503 })]) {
    await assert.rejects(checkServerAddress('https://mine.example', async () => response))
  }
  await assert.rejects(checkServerAddress('https://mine.example', async () => { throw new TypeError('offline') }))
  await assert.rejects(checkServerAddress('https://mine.example', async () => { throw new DOMException('timeout', 'TimeoutError') }))
  let called = false
  await assert.rejects(checkServerAddress('https://mine.example/api', async () => { called = true; return Response.json({ ok: true }) }))
  assert.equal(called, false)
})
