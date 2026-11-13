import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'

class FixtureSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3
  static instances: FixtureSocket[] = []
  readyState = FixtureSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: Array<{ type: string; companyId: string; active: boolean }> = []
  constructor(_url: string) { FixtureSocket.instances.push(this) }
  send(raw: string) { this.sent.push(JSON.parse(raw)) }
  open() { this.readyState = FixtureSocket.OPEN; this.onopen?.() }
  hello() { this.onmessage?.({ data: JSON.stringify({ type: 'hello', instanceId: 'fixture', ts: 0 }) }) }
  close() { this.readyState = FixtureSocket.CLOSED; this.onclose?.() }
}

test('workspace attention waits for authenticated hello, reports current focus, and repeats immediately after reconnect', async (t) => {
  const keys = ['localStorage', 'window', 'document', 'location', 'WebSocket'] as const
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  const storage = new Map<string, string>()
  const location = new URL('http://127.0.0.1')
  const windowEvents = Object.assign(new EventTarget(), { location })
  const documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true })
  const values = [
    { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    windowEvents, documentEvents, location, FixtureSocket,
  ]
  keys.forEach((key, i) => { Object.defineProperty(globalThis, key, { configurable: true, value: values[i] }) })
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ticket: 'fixture-ticket' }))
  let server: ViteDevServer | undefined
  let client: typeof import('../src/api/client') | undefined
  try {
    server = await createServer({
      configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
      resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
      server: { middlewareMode: true, watch: null }, appType: 'custom',
    })
    const auth = await server.ssrLoadModule('/src/stores/auth.ts') as typeof import('../src/stores/auth')
    client = await server.ssrLoadModule('/src/api/client.ts') as typeof client
    assert.ok(client)
    auth.useAuth.setState({ token: 'fixture-token', activeCompanyId: 'a' })
    await client.ws.connect()
    const first = FixtureSocket.instances.at(-1)!
    first.open()
    windowEvents.dispatchEvent(new Event('focus'))
    assert.deepEqual(first.sent, [], 'onopen is too early for the server to receive authenticated frames')
    first.hello()
    assert.deepEqual(first.sent, [{ type: 'workspace.view', companyId: 'a', active: true }])
    documentEvents.visibilityState = 'hidden'
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    assert.equal(first.sent.at(-1)?.active, false)
    auth.useAuth.setState({ activeCompanyId: 'b' })
    client.ws.reconnect()
    await client.ws.connect()
    const second = FixtureSocket.instances.at(-1)!
    assert.notEqual(first, second)
    second.open()
    first.hello()
    assert.deepEqual(second.sent, [], 'a stale socket hello cannot make the new socket ready')
    second.hello()
    assert.deepEqual(second.sent, [{ type: 'workspace.view', companyId: 'b', active: false }])
    documentEvents.visibilityState = 'visible'
    windowEvents.dispatchEvent(new Event('focus'))
    assert.equal(second.sent.at(-1)?.active, true)
    client.ws.close()
    const before = second.sent.length
    windowEvents.dispatchEvent(new Event('blur'))
    assert.equal(second.sent.length, before, 'closed sockets remove attention listeners')
  } finally {
    client?.ws.close()
    await server?.close()
    keys.forEach((key, i) => {
      const descriptor = descriptors[i]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
})
