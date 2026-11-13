import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { after, before, beforeEach, test } from 'node:test'
import { WebSocket, type WebSocketServer } from 'ws'
import { pool } from '../db/pool.js'
import { runCli } from '../agents/cli.js'
import { conversationReplyRevisions, type conversationControlStatus } from '../agents/conversation-control.js'
import { signAgentToken } from '../agents/runtime/jwt.js'
import { wakeAgent } from '../agents/scheduler.js'
import { createWsTicket } from '../auth.js'
import { inprocClient } from '../agents/runtime/inproc-client.js'
import { computeMessageRecipients, dispatchMessagePush, __setNotifyHookForTesting } from '../push.js'
import { recordWorkspaceView, removeWorkspaceView } from '../workspace-presence.js'
import { attachWebSocket, resolveWsEventRecipientUserIds } from '../ws.js'
import { buildApiTestApp, ensureSchemaOnce, resetAllTables, seedCompanyWithAgent, seedUserMembership, teardownAll } from './_helpers.js'

let server: Server
let sockets: WebSocketServer
let base = ''
const humanId = 'control-human'
before(async () => {
  await ensureSchemaOnce()
  const app = await buildApiTestApp(humanId)
  const { runtimeRouter } = await import('../agents/runtime/server.js')
  app.use('/runtime', runtimeRouter)
  server = createServer(app)
  sockets = attachWebSocket(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const addr = server.address()
  assert.ok(addr && typeof addr === 'object')
  base = `http://127.0.0.1:${addr.port}`
})
beforeEach(async () => { await resetAllTables() })
after(async () => {
  __setNotifyHookForTesting(null)
  for (const socket of sockets.clients) socket.terminate()
  await new Promise<void>((resolve) => { sockets.close(() => resolve()) })
  await teardownAll(server)
})

async function seed() {
  const { companyId, agentId } = await seedCompanyWithAgent()
  await seedUserMembership(humanId, companyId)
  const computerId = `comp-${randomUUID()}`
  await pool.query(`INSERT INTO computers (id, company_id, name, kind, available_engines, status) VALUES ($1,$2,'Test PC','local','["codex"]','online')`, [computerId, companyId])
  const assignment = await pool.query(`UPDATE participants SET computer_id = $1 WHERE id = $2 AND company_id = $3 RETURNING runtime_assignment_id`, [computerId, agentId, companyId])
  const token = signAgentToken({ agentId, companyId, computerId, assignmentId: assignment.rows[0].runtime_assignment_id })
  const room = async () => {
    const id = `room-${randomUUID()}`
    await pool.query(`INSERT INTO conversations (id,company_id,kind,title,members) VALUES ($1,$2,'direct','Test room',$3)`, [id, companyId, JSON.stringify([humanId, agentId])])
    return id
  }
  const conversationId = await room()
  return { companyId, agentId, computerId, token, conversationId, room }
}

async function control(companyId: string, id: string, paused: boolean) {
  const response = await fetch(`${base}/api/conversations/${id}/agent-control`, {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-company-id': companyId }, body: JSON.stringify({ paused }),
  })
  return { status: response.status, body: await response.json() as Awaited<ReturnType<typeof conversationControlStatus>> }
}
async function runtime(token: string, path: string, body?: unknown) {
  const response = await fetch(`${base}/runtime/${path}`, {
    method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, body: await response.json() }
}

test('pause persists across new messages, filters both inbox paths, blocks replies and resumes unread input', async () => {
  const s = await seed()
  const other = await s.room()
  const paused = await control(s.companyId, s.conversationId, true)
  assert.equal(paused.status, 200)
  assert.equal(paused.body.paused, true)
  assert.equal(paused.body.agents[0].confirmed, false)
  const repeat = await control(s.companyId, s.conversationId, true)
  assert.equal(repeat.body.revision, paused.body.revision, 'repeated pause is idempotent')
  assert.equal(await wakeAgent(s.agentId, 'manual', s.conversationId), false, 'synthetic wakes remain paused')
  const humanMessage = await fetch(`${base}/api/conversations/${s.conversationId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-company-id': s.companyId }, body: JSON.stringify({ body: 'human can still chat during pause' }),
  })
  assert.equal(humanMessage.status, 202, 'the existing message API accepts and persists human messages')
  const humanMessageId = (await humanMessage.json() as { id: string }).id
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = $1 AND author_id = $2 AND body = 'human can still chat during pause'`, [s.conversationId, humanId])).rows[0].n, 1)
  for (const id of [s.conversationId, other]) await pool.query(
    `INSERT INTO messages (id,conversation_id,company_id,author_id,kind,body,sequence) VALUES ($1,$2,$3,$4,'text',$5,$6)`,
    [`m-${randomUUID()}`, id, s.companyId, humanId, id === other ? 'other room input' : 'paused room input', id === other ? 1 : 2],
  )
  await pool.query('UPDATE conversation_counters SET next_sequence = 3 WHERE conversation_id = $1', [s.conversationId])
  const inbox = await inprocClient.loadInbox(s.agentId)
  assert.deepEqual(inbox.map((r) => r.conversation_id), [other])
  const cliInbox = await runCli(['--as', s.agentId, 'inbox'])
  assert.doesNotMatch(cliInbox.text, /paused room input/)
  assert.match(cliInbox.text, /other room input/)
  const reply = await runCli(['--as', s.agentId, 'reply', s.conversationId, 'should never be written'])
  assert.equal(reply.ok, false)
  assert.match(reply.text, /PAUSED/)
  const resumed = await control(s.companyId, s.conversationId, false)
  assert.equal(resumed.body.revision, paused.body.revision + 1)
  assert.equal((await inprocClient.loadInbox(s.agentId)).some((r) => r.conversation_id === s.conversationId), true)
  const cursor = () => pool.query('SELECT last_read_at, last_read_message_id FROM conversation_reads WHERE conversation_id = $1 AND user_id = $2', [s.conversationId, s.agentId])
  const beforeCursor = await cursor()
  await runtime(s.token, 'conversation/mark-read', { conversationId: s.conversationId, upToMessageId: humanMessageId, conversationRevision: 0 })
  assert.deepEqual((await cursor()).rows, beforeCursor.rows, 'an obsolete turn cannot acknowledge input after a quick pause/resume')
  const stale = await conversationReplyRevisions.run({ [s.conversationId]: 0 }, () => runCli(['--as', s.agentId, 'reply', s.conversationId, 'obsolete turn']))
  assert.equal(stale.ok, false)
  const fresh = await conversationReplyRevisions.run({ [s.conversationId]: resumed.body.revision }, () => runCli(['--as', s.agentId, 'reply', s.conversationId, 'fresh answer']))
  assert.equal(fresh.ok, true, fresh.text)
})

test('only the current member and assignment can confirm the current stop generation', async () => {
  const s = await seed()
  const paused = await control(s.companyId, s.conversationId, true)
  const ack = (revision: number) => runtime(s.token, 'conversation-controls/ack', { conversationId: s.conversationId, revision, agentId: humanId })
  await ack(paused.body.revision - 1)
  let state = await control(s.companyId, s.conversationId, true)
  assert.equal(state.body.agents[0].confirmed, false)
  await ack(paused.body.revision)
  state = await control(s.companyId, s.conversationId, true)
  assert.equal(state.body.agents[0].confirmed, true)
  const rows = await pool.query('SELECT agent_id FROM conversation_agent_control_acks')
  assert.deepEqual(rows.rows.map((r) => r.agent_id), [s.agentId])
  await pool.query(`UPDATE participants SET runtime_assignment_id = $1 WHERE id = $2 AND company_id = $3`, [randomUUID(), s.agentId, s.companyId])
  assert.equal((await ack(paused.body.revision)).status, 403)
  state = await control(s.companyId, s.conversationId, true)
  assert.equal(state.body.agents[0].confirmed, false)
})

test('nonmembers cannot pause or probe a room; managed engines are explicitly unsupported', async () => {
  const s = await seed()
  const hidden = `hidden-${randomUUID()}`
  await pool.query(`INSERT INTO conversations (id,company_id,kind,title,members) VALUES ($1,$2,'group','Private',$3)`, [hidden, s.companyId, JSON.stringify([s.agentId])])
  assert.equal((await control(s.companyId, hidden, true)).status, 404)
  await pool.query(`UPDATE participants SET computer_id = NULL WHERE id = $1 AND company_id = $2`, [s.agentId, s.companyId])
  assert.equal((await control(s.companyId, s.conversationId, true)).status, 409)
  assert.equal((await pool.query('SELECT agents_paused FROM conversations WHERE id = $1', [s.conversationId])).rows[0].agents_paused, false)
})

test('a reply queued behind a committed pause cannot write a message', async () => {
  const s = await seed()
  const holder = await pool.connect()
  await holder.query('BEGIN')
  await holder.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [s.conversationId])
  const waitForLock = async (snippet: string) => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const result = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1`, [`%${snippet}%`])
      if (result.rowCount) return
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error(`query did not queue: ${snippet}`)
  }
  const pausing = control(s.companyId, s.conversationId, true)
  let reply: ReturnType<typeof runCli> | undefined
  try {
    await waitForLock('SELECT c.members, c.kind, c.pinned')
    reply = runCli(['--as', s.agentId, 'reply', s.conversationId, 'racing reply'])
    await waitForLock('SELECT c.id, c.agents_paused')
  } finally { await holder.query('COMMIT'); holder.release() }
  assert.equal((await pausing).status, 200)
  assert.equal((await reply)?.ok, false)
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = $1', [s.conversationId])).rows[0].n, 0)
})

test('viewing workspace A does not silence workspace B; multiple sockets, expiry, mute and revocation are respected', async () => {
  const s = await seed()
  const other = await seedCompanyWithAgent()
  await seedUserMembership(humanId, other.companyId)
  const socket = `socket-${randomUUID()}`
  const secondSocket = `socket-${randomUUID()}`
  const now = Date.now()
  try {
    await recordWorkspaceView(humanId, other.companyId, socket)
    assert.deepEqual(await computeMessageRecipients({ conversationId: s.conversationId, authorId: s.agentId }), [humanId])
    await recordWorkspaceView(humanId, s.companyId, socket)
    await recordWorkspaceView(humanId, s.companyId, secondSocket)
    assert.deepEqual(await computeMessageRecipients({ conversationId: s.conversationId, authorId: s.agentId }), [])
    await removeWorkspaceView(humanId, s.companyId, socket)
    assert.deepEqual(await computeMessageRecipients({ conversationId: s.conversationId, authorId: s.agentId }), [])
    await removeWorkspaceView(humanId, s.companyId, secondSocket)
    await recordWorkspaceView(humanId, s.companyId, socket, now - 80_000)
    assert.deepEqual(await computeMessageRecipients({ conversationId: s.conversationId, authorId: s.agentId }), [humanId])
    const event = { type: 'message.notification', companyId: s.companyId, conversationId: s.conversationId, recipientUserIds: [humanId] }
    assert.deepEqual([...await resolveWsEventRecipientUserIds(event)], [humanId])
    await pool.query('INSERT INTO conversation_mutes (user_id,conversation_id) VALUES ($1,$2)', [humanId, s.conversationId])
    assert.deepEqual(await computeMessageRecipients({ conversationId: s.conversationId, authorId: s.agentId }), [])
    assert.deepEqual([...await resolveWsEventRecipientUserIds(event)], [], 'a mute committed before delivery suppresses a queued live notification')
    await pool.query(`UPDATE conversations SET members = $2 WHERE id = $1`, [s.conversationId, JSON.stringify([s.agentId])])
    assert.deepEqual([...await resolveWsEventRecipientUserIds(event)], [])
  } finally {
    await removeWorkspaceView(humanId, other.companyId, socket)
    await removeWorkspaceView(humanId, s.companyId, socket)
    await removeWorkspaceView(humanId, s.companyId, secondSocket)
  }
})

test('agent replies dispatch a cross-workspace notification and retain safe push recipients', async () => {
  const s = await seed()
  const captured: Array<{ recipientUserIds: string[] }> = []
  __setNotifyHookForTesting((args) => { captured.push(args) })
  try {
    await dispatchMessagePush({ companyId: s.companyId, conversationId: s.conversationId, authorId: s.agentId, messageId: 'test-message', body: 'hello' })
    assert.deepEqual(captured.map((a) => a.recipientUserIds), [[humanId]])
  } finally { __setNotifyHookForTesting(null) }
})

test('a real authenticated socket reports workspace attention, receives foreign-room notices and releases its lease on close', async () => {
  const s = await seed()
  const a = await seedCompanyWithAgent()
  await seedUserMembership(humanId, a.companyId)
  const { ticket } = await createWsTicket(humanId)
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?t=${ticket}`)
  const events: Array<{ type: string; message?: { id: string } }> = []
  let receivedHello!: () => void
  const hello = new Promise<void>((resolve) => { receivedHello = resolve })
  socket.on('message', (raw) => {
    const event = JSON.parse(raw.toString())
    events.push(event)
    if (event.type === 'hello') receivedHello()
  })
  const waitUntil = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 5000
    while (!(await condition())) {
      assert.ok(Date.now() < deadline, 'socket state did not converge')
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  try {
    await Promise.race([hello, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('no hello')), 5000); timer.unref() })])
    socket.send(JSON.stringify({ type: 'workspace.view', companyId: s.companyId, active: true }))
    await waitUntil(async () => (await computeMessageRecipients({ conversationId: s.conversationId, authorId: s.agentId })).length === 0)
    socket.send(JSON.stringify({ type: 'workspace.view', companyId: a.companyId, active: true }))
    await waitUntil(async () => (await computeMessageRecipients({ conversationId: s.conversationId, authorId: s.agentId })).includes(humanId))
    await dispatchMessagePush({ companyId: s.companyId, conversationId: s.conversationId, authorId: s.agentId, messageId: 'socket-notice', body: 'foreign workspace notice' })
    await waitUntil(() => events.some((e) => e.type === 'message.notification' && e.message?.id === 'socket-notice'))
    socket.send(JSON.stringify({ type: 'workspace.view', companyId: s.companyId, active: true }))
    await waitUntil(async () => (await computeMessageRecipients({ conversationId: s.conversationId, authorId: s.agentId })).length === 0)
  } finally {
    const closed = new Promise<void>((resolve) => { socket.once('close', resolve) })
    socket.close()
    await closed
  }
  await waitUntil(async () => (await computeMessageRecipients({ conversationId: s.conversationId, authorId: s.agentId })).includes(humanId))
})
