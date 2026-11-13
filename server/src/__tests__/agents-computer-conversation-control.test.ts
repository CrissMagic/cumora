import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentRunner, RuntimeCliBroker } from '../agents/computer/daemon.js'
import type { EngineRunResult, EngineSession } from '../agents/computer/engine.js'
import type { ConversationTurnControl, ConversationControl } from '../agents/computer/conversation-control.js'
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

type Runner = {
  token: string
  busy: boolean
  executionSignal: AbortSignal
  conversationControl: ConversationTurnControl
  chatTurnSignal: AbortSignal | null
  engineSession: EngineSession | null
  cliBroker: Pick<RuntimeCliBroker, 'start' | 'stop'> | null
  ensureEngineSession(): EngineSession | null
  turnPrompt(): string
  nativeImagePaths(): string[]
  invokeRuntimeCli(argv: string[], signal: AbortSignal): Promise<{ text?: string; exitCode: number; error?: string }>
  runEngineAttempt(delta: string, resume: string | null): Promise<EngineRunResult>
  maybeSteer(conversationId: string): Promise<void>
  ensureToken(signal?: AbortSignal): Promise<string>
  snapshotUnread(): Promise<{ seen: Map<string, string>; digest: string; hasReal: boolean; projectIds: string[]; imagePaths: string[] }>
  inboxTriage(): Promise<{ actionable: boolean }>
  postStatus(): Promise<void>
  memoryDigest(): Promise<string>
  ackSeen(token: string, seen: Map<string, string>): Promise<void>
  runWithSessionRecovery(): Promise<EngineRunResult>
  runTurn(reason: string): Promise<void>
  refreshConversationControls(): Promise<void>
  publishEngineFailure(): Promise<void>
}

function makeRunner(): Runner {
  return new AgentRunner(
    { serverUrl: 'https://server.example.test', computerId: 'fixture', deviceToken: 'fixture' },
    { id: 'fixture', name: 'Fixture', role: null, systemPrompt: null, engine: 'codex', model: null, fastModel: null }, 'codex',
  ) as unknown as Runner
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test('a busy runner cancels a mixed-room engine, confirms after cleanup, reruns the other room and never emits a provider failure', async (t) => {
  const runner = new AgentRunner(
    { serverUrl: 'https://server.example.test', computerId: 'fixture', deviceToken: 'fixture' },
    { id: 'fixture', name: 'Fixture', role: null, systemPrompt: null, engine: 'codex', model: null, fastModel: null }, 'codex',
  ) as unknown as Runner
  let rows: ConversationControl[] = []
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  let engineFinished = false
  let ackBeforeEngineFinished = false
  let brokerStops = 0
  let brokerStarts = 0
  runner.cliBroker = { stop: async () => { brokerStops++ }, start: async () => { brokerStarts++ } }
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    calls.push({ path, body })
    if (path === '/runtime/conversation-controls') return Response.json(rows)
    if (path === '/runtime/conversation-controls/ack' && !engineFinished) ackBeforeEngineFinished = true
    return Response.json(path === '/runtime/runs' ? { runId: 'run-fixture' } : {})
  })
  t.mock.method(runner, 'ensureToken', async () => 'fixture-token')
  t.mock.method(runner, 'postStatus', async () => {})
  t.mock.method(runner, 'memoryDigest', async () => '')
  t.mock.method(runner, 'inboxTriage', async () => ({ actionable: true }))
  let snapshots = 0
  t.mock.method(runner, 'snapshotUnread', async () => ({
    seen: new Map(++snapshots === 1 ? [['a', 'ma'], ['b', 'mb']] : [['b', 'mb']]),
    digest: 'task', hasReal: true, projectIds: [], imagePaths: [],
  }))
  const acked: string[][] = []
  t.mock.method(runner, 'ackSeen', async (_token: string, seen: Map<string, string>) => { acked.push([...seen.keys()]) })
  const failure = t.mock.method(runner, 'publishEngineFailure', async () => {})
  let started!: () => void
  const firstStarted = new Promise<void>((resolve) => { started = resolve })
  let engines = 0
  t.mock.method(runner, 'runWithSessionRecovery', async () => {
    if (++engines > 1) return { exitCode: 0 }
    const signal = runner.executionSignal
    started()
    try {
      await new Promise<void>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) })
      return { exitCode: 0 }
    } finally { engineFinished = true }
  })
  const turn = runner.runTurn('test')
  await firstStarted
  rows = [{ conversationId: 'a', paused: true, revision: 1 }]
  await runner.refreshConversationControls()
  await turn
  assert.equal(engineFinished, true)
  assert.equal(ackBeforeEngineFinished, false)
  assert.equal(engines, 2)
  assert.deepEqual(acked, [['b']])
  assert.equal(failure.mock.callCount(), 0)
  assert.equal(runner.busy, false)
  assert.ok(brokerStops > 0)
  assert.equal(brokerStarts, 1, 'the cancelled broker restarts before the remaining room runs')
  assert.ok(calls.some((c) => c.path.endsWith('/finish') && c.body.status === 'skipped'))
  assert.ok(calls.some((c) => c.path.endsWith('/conversation-controls/ack') && c.body.conversationId === 'a'))
})

test('a token refresh waiting across pause/resume cannot send the old reply', async (t) => {
  const runner = makeRunner()
  runner.chatTurnSignal = runner.conversationControl.begin()
  runner.conversationControl.scope(['a'])
  const token = deferred<string>()
  const entered = deferred<void>()
  t.mock.method(runner, 'ensureToken', async () => { entered.resolve(); return token.promise })
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ text: 'sent', exitCode: 0 }))
  const request = runner.invokeRuntimeCli(['reply', 'a', 'old answer'], new AbortController().signal)
  await entered.promise
  runner.conversationControl.apply([{ conversationId: 'a', paused: true, revision: 1 }])
  runner.conversationControl.finish()
  runner.conversationControl.apply([{ conversationId: 'a', paused: false, revision: 2 }])
  runner.chatTurnSignal = runner.conversationControl.begin()
  runner.conversationControl.scope(['a'])
  token.resolve('fixture-token')
  assert.equal((await request).exitCode, 70)
  assert.equal(fetch.mock.callCount(), 0, 'no old reply may be dispatched as the resumed turn')
})

test('normal completion drains the old IPC broker before releasing the turn context', async (t) => {
  const runner = makeRunner()
  t.mock.method(runner, 'ensureToken', async () => 'fixture-token')
  t.mock.method(runner, 'postStatus', async () => {})
  t.mock.method(runner, 'memoryDigest', async () => '')
  t.mock.method(runner, 'inboxTriage', async () => ({ actionable: true }))
  t.mock.method(runner, 'ackSeen', async () => {})
  t.mock.method(runner, 'snapshotUnread', async () => ({ seen: new Map([['a', 'ma']]), digest: 'task', hasReal: true, projectIds: [], imagePaths: [] }))
  t.mock.method(runner, 'runWithSessionRecovery', async () => ({ exitCode: 0 }))
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => Response.json(String(url).endsWith('/conversation-controls') ? [] : {}))
  const draining = deferred<void>()
  const stopped = deferred<void>()
  runner.cliBroker = { start: async () => {}, stop: () => { draining.resolve(); return stopped.promise } }
  const turn = runner.runTurn('normal completion')
  try {
    const first = await Promise.race([turn.then(() => 'completed'), draining.promise.then(() => 'draining')])
    assert.equal(first, 'draining', 'a later turn cannot start while old IPC work remains')
    assert.equal(runner.busy, true)
    assert.deepEqual(runner.conversationControl.revisions, { a: 0 })
  } finally { stopped.resolve(); await turn }
  assert.equal(runner.busy, false)
  assert.equal(runner.conversationControl.revisions, undefined)
})

test('a normally finished turn cannot borrow the next turn revision while its CLI awaits a token', async (t) => {
  const runner = makeRunner()
  runner.chatTurnSignal = runner.conversationControl.begin()
  runner.conversationControl.scope(['a'])
  const token = deferred<string>()
  t.mock.method(runner, 'ensureToken', async () => token.promise)
  let revision: number | undefined
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    revision = JSON.parse(String(init?.body)).conversationRevisions.a
    return Response.json({ text: 'obsolete answer rejected by the server', exitCode: 2 })
  })
  const request = runner.invokeRuntimeCli(['reply', 'a', 'old answer'], new AbortController().signal)
  runner.conversationControl.finish()
  runner.conversationControl.apply([{ conversationId: 'a', paused: false, revision: 2 }])
  runner.chatTurnSignal = runner.conversationControl.begin()
  runner.conversationControl.scope(['a'])
  token.resolve('fixture-token')
  await request
  assert.equal(revision, 0, 'the server must receive the originating generation, not the resumed generation')
})

test('cancellation aborts an already dispatched CLI request', async (t) => {
  const runner = makeRunner()
  runner.chatTurnSignal = runner.conversationControl.begin()
  runner.conversationControl.scope(['a'])
  t.mock.method(runner, 'ensureToken', async () => 'fixture-token')
  const entered = deferred<AbortSignal>()
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal
    assert.ok(signal)
    entered.resolve(signal)
    return new Promise<Response>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) })
  })
  const request = runner.invokeRuntimeCli(['reply', 'a', 'old answer'], new AbortController().signal)
  const signal = await entered.promise
  runner.conversationControl.apply([{ conversationId: 'a', paused: true, revision: 1 }])
  assert.equal((await request).exitCode, 70)
  assert.equal(signal.aborted, true)
})

test('queued IPC files are discarded after cancellation and fresh IPC works after resume', async (t) => {
  const runner = makeRunner()
  runner.chatTurnSignal = runner.conversationControl.begin()
  runner.conversationControl.scope(['a'])
  const root = await mkdtemp(join(tmpdir(), 'cumora-cancelled-ipc-'))
  const ipc = join(root, 'ipc')
  const oldToken = deferred<string>()
  const entered = deferred<void>()
  const aborted = deferred<void>()
  let tokens = 0
  t.mock.method(runner, 'ensureToken', async (signal?: AbortSignal) => {
    if (++tokens === 1) {
      signal?.addEventListener('abort', () => aborted.resolve(), { once: true })
      entered.resolve()
      return oldToken.promise
    }
    return 'fixture-token'
  })
  const sent: string[][] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/conversation-controls')) return Response.json([{ conversationId: 'a', paused: true, revision: 1 }])
    if (String(url).endsWith('/cli')) sent.push(JSON.parse(String(init?.body)).argv)
    return Response.json({ text: 'sent', exitCode: 0 })
  })
  const broker = new RuntimeCliBroker(ipc, join(root, 'processing'), (argv, signal) => runner.invokeRuntimeCli(argv, signal))
  runner.cliBroker = broker
  const request = async (body: string) => {
    const name = join(ipc, 'requests', randomUUID())
    await writeFile(`${name}.tmp`, JSON.stringify({ argv: ['reply', 'a', body] }))
    await rename(`${name}.tmp`, `${name}.json`)
  }
  try {
    await broker.start()
    await request('old in flight')
    await entered.promise
    await request('old queued')
    const cancelled = runner.refreshConversationControls()
    await aborted.promise
    oldToken.resolve('fixture-token')
    await cancelled
    runner.conversationControl.finish()
    runner.conversationControl.apply([{ conversationId: 'a', paused: false, revision: 2 }])
    runner.chatTurnSignal = runner.conversationControl.begin()
    runner.conversationControl.scope(['a'])
    await broker.start()
    assert.deepEqual(await readdir(join(ipc, 'requests')), [])
    await request('fresh answer')
    await broker.poll()
    assert.deepEqual(sent, [['reply', 'a', 'fresh answer']])
  } finally {
    oldToken.resolve('fixture-token')
    await broker.stop()
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}cumora-cancelled-ipc-`))
    await rm(root, { recursive: true, force: true })
  }
})

test('late steering from a paused room leaves the other persistent room running normally', async (t) => {
  const runner = makeRunner()
  runner.chatTurnSignal = runner.conversationControl.begin()
  runner.conversationControl.scope(['b'])
  t.mock.method(runner, 'ensureToken', async () => 'fixture-token')
  const engine = deferred<EngineRunResult>()
  const session: EngineSession = {
    alive: true, sessionId: null, carriesStandingPrompt: false,
    send: () => engine.promise, steer() {}, stop: async () => { engine.resolve({ exitCode: 128 }) },
  }
  const stop = t.mock.method(session, 'stop')
  const steer = t.mock.method(session, 'steer')
  runner.engineSession = session
  t.mock.method(runner, 'ensureEngineSession', () => session)
  t.mock.method(runner, 'turnPrompt', () => 'b task')
  t.mock.method(runner, 'nativeImagePaths', () => [])
  const result = runner.runEngineAttempt('b task', null)
  const inbox = deferred<Response>()
  const entered = deferred<void>()
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    if (String(url).includes('/inbox?')) { entered.resolve(); return inbox.promise }
    if (String(url).endsWith('/conversation-controls')) return Response.json([{ conversationId: 'a', paused: true, revision: 1 }])
    return Response.json({ ok: true })
  })
  try {
    const injecting = runner.maybeSteer('a')
    await entered.promise
    await runner.refreshConversationControls()
    inbox.resolve(Response.json({ rows: [{ id: 'ma', conversation_id: 'a', conversation_kind: 'direct', author_kind: 'human', body: 'old probe' }] }))
    await injecting
    await runner.refreshConversationControls()
    assert.equal(runner.conversationControl.cancelled, false)
    assert.equal(stop.mock.callCount(), 0)
    assert.equal(steer.mock.callCount(), 0)
    engine.resolve({ exitCode: 0 })
    assert.equal((await result).exitCode, 0)
  } finally { engine.resolve({ exitCode: 0 }); await result.catch(() => {}) }
})

test('a broker refuses restart when stale protocol entries cannot be removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cumora-blocked-ipc-'))
  const ipc = join(root, 'ipc')
  let calls = 0
  const broker = new RuntimeCliBroker(ipc, join(root, 'processing'), async () => { calls++; return { exitCode: 0 } })
  try {
    await broker.start()
    await broker.stop()
    // Directories cannot be removed by the broker's nonrecursive cleanup on
    // either Windows or POSIX. It must fail closed instead of ignoring this.
    await mkdir(join(ipc, 'requests', `${randomUUID()}.json`))
    await assert.rejects(broker.start(), (error: unknown) => ['ERR_FS_EISDIR', 'EISDIR', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? ''))
    await broker.poll()
    assert.equal(calls, 0)
  } finally {
    await broker.stop()
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}cumora-blocked-ipc-`))
    await rm(root, { recursive: true, force: true })
  }
})
