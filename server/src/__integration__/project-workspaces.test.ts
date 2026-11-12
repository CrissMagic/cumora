import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { after, before, beforeEach, test } from 'node:test'
import { pool } from '../db/pool.js'
import { bindProjectWorkspace, agentProjectWorkspaces, reportProjectWorkspace } from '../project-workspaces.js'
import { buildApiTestApp, ensureSchemaOnce, resetAllTables, teardownAll } from './_helpers.js'
import type { ProjectWorkspace } from '../../../shared/project-workspaces.js'
import { runtimeRouter } from '../agents/runtime/server.js'
import { signAgentToken } from '../agents/runtime/jwt.js'
import { getSeen } from '../agents/seen-boundary.js'
import { redis } from '../redis.js'
import { AgentRunner } from '../agents/computer/daemon.js'
import { EngineSessionStore } from '../agents/computer/session-store.js'
import type { EngineRunResult } from '../agents/computer/engine.js'
import type { WakeBackgroundBrief } from '../agents/runtime/wake-options.js'

const execFileP = promisify(execFile)

let server: Server
let base = ''
const headers = { 'content-type': 'application/json', 'x-company-id': 'co-a' }

before(async () => {
  await ensureSchemaOnce()
  const app = await buildApiTestApp('owner-a')
  app.use('/runtime', runtimeRouter)
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  base = `http://127.0.0.1:${address.port}`
})
beforeEach(async () => {
  await resetAllTables()
  await pool.query(`INSERT INTO users (id, email, display_name) VALUES
    ('owner-a', 'owner-a@test.local', 'Owner A'), ('owner-b', 'owner-b@test.local', 'Owner B')`)
  await pool.query(`INSERT INTO companies (id, name, slug, owner_user_id) VALUES
    ('co-a', 'Company A', 'company-a', 'owner-a'), ('co-b', 'Company B', 'company-b', 'owner-b')`)
  await pool.query(`INSERT INTO company_members (company_id, user_id, role) VALUES
    ('co-a', 'owner-a', 'owner'), ('co-a', 'owner-b', 'member'), ('co-b', 'owner-b', 'owner')`)
  await pool.query(`INSERT INTO projects (id, company_id, name) VALUES
    ('project-a', 'co-a', 'Project A'), ('project-b', 'co-b', 'Project B')`)
  await pool.query(`INSERT INTO computers (id, company_id, owner_user_id, name, kind, available_engines) VALUES
    ('pc-a', 'co-a', 'owner-a', 'Computer A', 'local', '["mimo"]'),
    ('pc-peer', 'co-a', 'owner-b', 'Peer computer', 'local', '["mimo"]'),
    ('pc-b', 'co-b', 'owner-b', 'Computer B', 'local', '["mimo"]')`)
})
after(async () => { await teardownAll(server) })

const bind = (computerId: string, path: string, projectId = 'project-a') =>
  fetch(`${base}/api/projects/${projectId}/workspaces/${computerId}`, { method: 'PUT', headers, body: JSON.stringify({ path }) })

test('[integration] project creation binds an owned computer in the same transaction', async () => {
  const response = await fetch(`${base}/api/projects`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Mobile project', workspace: { computerId: 'pc-a', path: '/projects/mobile' } }),
  })
  assert.equal(response.status, 201, await response.clone().text())
  const project = await response.json() as { id: string }
  const rows = await pool.query(`SELECT p.name, w.path, w.status FROM projects p
    JOIN project_workspaces w ON w.project_id = p.id WHERE p.id = $1 AND p.company_id = 'co-a'`, [project.id])
  assert.deepEqual(rows.rows, [{ name: 'Mobile project', path: '/projects/mobile', status: 'pending' }])
})

test('[integration] project creation rolls back invalid or unauthorized bindings without orphan projects', async () => {
  for (const [workspace, expected] of [
    [{ computerId: 'pc-a', path: '../repo' }, 400],
    [{ computerId: 'pc-peer', path: '/repo' }, 403],
    [{ computerId: 'pc-b', path: '/repo' }, 403],
    [{ computerId: 'missing', path: '/repo' }, 403],
    [null, 400],
  ] as const) {
    const response = await fetch(`${base}/api/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'Failed mobile project', workspace }) })
    assert.equal(response.status, expected, await response.clone().text())
    assert.equal((await pool.query('SELECT 1 FROM projects')).rowCount, 2)
    assert.equal((await pool.query('SELECT 1 FROM project_workspaces')).rowCount, 0)
  }
  await pool.query("UPDATE company_members SET role = 'member' WHERE company_id = 'co-a' AND user_id = 'owner-a'")
  const denied = await fetch(`${base}/api/projects`, { method: 'POST', headers,
    body: JSON.stringify({ name: 'Member bound project', workspace: { computerId: 'pc-a', path: '/repo' } }) })
  assert.equal(denied.status, 403)
  assert.equal((await pool.query('SELECT 1 FROM projects')).rowCount, 2)
  const unbound = await fetch(`${base}/api/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'Member unbound project' }) })
  assert.equal(unbound.status, 201)
  assert.equal((await pool.query('SELECT 1 FROM project_workspaces')).rowCount, 0)
})

test('[integration] project listing includes own directory status without exposing another computer owner or tenant', async () => {
  await bindProjectWorkspace({ projectId: 'project-a', computerId: 'pc-a', companyId: 'co-a', userId: 'owner-a', path: '/own/repo' })
  await bindProjectWorkspace({ projectId: 'project-a', computerId: 'pc-peer', companyId: 'co-a', userId: 'owner-b', path: '/peer/private' })
  await bindProjectWorkspace({ projectId: 'project-b', computerId: 'pc-b', companyId: 'co-b', userId: 'owner-b', path: '/other/private' })
  const response = await fetch(`${base}/api/projects`, { headers })
  assert.equal(response.status, 200)
  const projects = await response.json() as Array<{ id: string; workspaces: Array<{ computerId: string; path: string; status: string }> }>
  assert.deepEqual(projects.map((p) => p.id), ['project-a'])
  assert.equal(projects[0].workspaces.length, 1)
  assert.equal(projects[0].workspaces[0].computerId, 'pc-a')
  assert.equal(projects[0].workspaces[0].path, '/own/repo')
  assert.equal(projects[0].workspaces[0].status, 'pending')
})

async function seedProjectAgent(): Promise<string> {
  const { rows } = await pool.query<{ assignment: string }>(`INSERT INTO participants
    (id, company_id, kind, name, initial, avatar_bg, status, computer_id, engine) VALUES
    ('agent-a', 'co-a', 'agent', 'Agent', 'A', '#ffffff', 'avail', 'pc-a', 'mimo')
    RETURNING runtime_assignment_id AS assignment`)
  await pool.query(`INSERT INTO conversations (id, company_id, kind, title, project_id, members) VALUES
    ('room-a', 'co-a', 'group', 'Room A', 'project-a', '["agent-a"]')`)
  return signAgentToken({ agentId: 'agent-a', companyId: 'co-a', computerId: 'pc-a', assignmentId: rows[0].assignment, projectWorkspaces: true })
}

test('[integration] owned project binding is persisted, revalidated after change, and detached without touching project contents', async () => {
  const response = await bind('pc-a', 'E:\\projects\\existing-repo')
  assert.equal(response.status, 200, await response.clone().text())
  const original = await response.json() as ProjectWorkspace
  assert.equal(original.path, 'E:\\projects\\existing-repo')
  assert.equal(original.status, 'pending')
  await reportProjectWorkspace('pc-a', original.id, { status: 'ready', isGit: true })
  const listing = await fetch(`${base}/api/projects/project-a/workspaces`, { headers })
  const listed = await listing.json() as { workspaces: ProjectWorkspace[]; computers: Array<{ id: string }> }
  assert.equal(listed.workspaces[0].status, 'ready')
  assert.deepEqual(listed.computers.map((row) => row.id), ['pc-a'])
  const reboundResponse = await bind('pc-a', 'E:\\projects\\other-repo')
  const rebound = await reboundResponse.json() as ProjectWorkspace
  assert.notEqual(rebound.id, original.id)
  await reportProjectWorkspace('pc-a', original.id, { status: 'ready', isGit: true })
  const { rows } = await pool.query('SELECT status, path FROM project_workspaces')
  assert.deepEqual(rows, [{ status: 'pending', path: 'E:\\projects\\other-repo' }])
  const removed = await fetch(`${base}/api/projects/project-a/workspaces/pc-a`, { method: 'DELETE', headers })
  assert.equal(removed.status, 200)
  assert.equal((await pool.query('SELECT 1 FROM project_workspaces')).rowCount, 0)
  assert.equal((await pool.query("SELECT 1 FROM projects WHERE id = 'project-a'")).rowCount, 1)
})

test('[integration] another tenant or computer owner cannot acquire a directory binding', async () => {
  for (const computerId of ['pc-peer', 'pc-b', 'missing']) assert.equal((await bind(computerId, '/repo')).status, 403)
  assert.equal((await bind('pc-a', '/repo', 'project-b')).status, 403)
  assert.equal((await bind('pc-a', '../repo')).status, 400)
  assert.equal((await pool.query('SELECT 1 FROM project_workspaces')).rowCount, 0)
})

test('[integration] status reports are pinned to the exact computer and binding generation', async () => {
  const binding = await bindProjectWorkspace({ projectId: 'project-a', computerId: 'pc-a', companyId: 'co-a', userId: 'owner-a', path: '/repo' })
  assert.ok(binding)
  await reportProjectWorkspace('pc-b', binding.id, { status: 'ready', isGit: true })
  assert.equal((await pool.query('SELECT status FROM project_workspaces')).rows[0].status, 'pending')
  await reportProjectWorkspace('pc-a', binding.id, { status: 'error', error: 'directory not found' })
  assert.deepEqual((await pool.query('SELECT status, error FROM project_workspaces')).rows[0], { status: 'error', error: 'directory not found' })
})

test('[integration] only member projects resolve to this runtime; mappings on another computer remain explicit', async () => {
  await bind('pc-a', '/repo-a')
  await seedProjectAgent()
  const own = await agentProjectWorkspaces('agent-a', 'co-a', 'pc-a')
  assert.equal(own.length, 1)
  assert.equal(own[0].workspace?.path, '/repo-a')
  assert.deepEqual(await agentProjectWorkspaces('agent-a', 'co-a', 'pc-peer'), [{ projectId: 'project-a', workspace: null }])
  assert.deepEqual(await agentProjectWorkspaces('agent-a', 'co-b', 'pc-b'), [])
  assert.deepEqual(await agentProjectWorkspaces('not-a-member', 'co-a', 'pc-a'), [])
})

test('[integration] filtering a project inbox does not advance another project freshness boundary', async () => {
  // PG reset does not clear Redis high-water marks from a prior test run.
  await redis.del('cumora:seen:agent-a:room-a', 'cumora:seen:agent-a:room-other')
  const token = await seedProjectAgent()
  await pool.query(`INSERT INTO projects (id, company_id, name) VALUES ('project-other', 'co-a', 'Other')`)
  await pool.query(`INSERT INTO conversations (id, company_id, kind, title, project_id, members) VALUES
    ('room-other', 'co-a', 'group', 'Other', 'project-other', '["agent-a"]')`)
  await pool.query(`INSERT INTO participants (id, company_id, kind, name, initial, avatar_bg, status) VALUES
    ('owner-a', 'co-a', 'human', 'Owner', 'O', '#ffffff', 'avail')`)
  await pool.query(`INSERT INTO messages (id, company_id, conversation_id, author_id, kind, body, sequence) VALUES
    ('message-a', 'co-a', 'room-a', 'owner-a', 'text', 'work in A', 41),
    ('message-other', 'co-a', 'room-other', 'owner-a', 'text', 'work in Other', 42)`)
  await bind('pc-a', '/repo-a')
  const preview = await fetch(`${base}/runtime/inbox?workspaceContext=1`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(preview.status, 200)
  const metadata = await preview.json() as { projectWorkspaces: Array<{ projectId: string }> }
  assert.deepEqual(metadata.projectWorkspaces.map((row) => row.projectId), ['project-a'])
  assert.equal(await getSeen('agent-a', 'room-a'), 0)
  assert.equal(await getSeen('agent-a', 'room-other'), 0)
  const response = await fetch(`${base}/runtime/inbox?scopeProject=project-a`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(response.status, 200, await response.clone().text())
  const result = await response.json() as { rows: Array<{ id: string }> }
  assert.deepEqual(result.rows.map((row) => row.id), ['message-a'])
  assert.equal(await getSeen('agent-a', 'room-a'), 41)
  assert.equal(await getSeen('agent-a', 'room-other'), 0)
})

test('[integration] a legacy daemon token stops being usable as soon as its project receives a local binding', async () => {
  await seedProjectAgent()
  const { rows } = await pool.query("SELECT runtime_assignment_id FROM participants WHERE id = 'agent-a'")
  const legacy = signAgentToken({ agentId: 'agent-a', companyId: 'co-a', computerId: 'pc-a', assignmentId: rows[0].runtime_assignment_id })
  const headers = { authorization: `Bearer ${legacy}` }
  assert.equal((await fetch(`${base}/runtime/inbox?probe=1`, { headers })).status, 200)
  await bind('pc-a', '/repo')
  assert.equal((await fetch(`${base}/runtime/inbox?probe=1`, { headers })).status, 403)
})

test('[integration] newly bound projects route manual tasks before daemon discovery refreshes', async () => {
  const token = await seedProjectAgent()
  await bind('pc-a', '/repo-a')
  await pool.query(`INSERT INTO projects (id, company_id, name) VALUES ('project-other', 'co-a', 'Other')`)
  await pool.query(`INSERT INTO conversations (id, company_id, kind, title, project_id, members) VALUES
    ('room-other', 'co-a', 'group', 'Other', 'project-other', '["agent-a"]')`)
  await bind('pc-a', '/repo-b', 'project-other')
  const runner = new AgentRunner({ serverUrl: base, computerId: 'pc-a', deviceToken: 'unused' }, {
    id: 'agent-a', name: 'Agent', role: null, systemPrompt: null, engine: 'mimo', model: null, fastModel: null,
    projectWorkspaces: false, // stale discovery; runtime metadata is authoritative
  }, 'mimo')
  const access = runner as unknown as {
    queueBackgroundBrief(brief: WakeBackgroundBrief, conversationId: string): void
    projectBriefQueue: Array<{ conversationId: string; brief: WakeBackgroundBrief }>
    snapshotUnread(token: string, conversationId: string, manual: boolean): Promise<unknown>
    turnWorkspaceContext: { projectId: string; workspace: ProjectWorkspace }
  }
  access.queueBackgroundBrief({ title: 'Task A', body: 'Work in A' }, 'room-a')
  access.queueBackgroundBrief({ title: 'Task B', body: 'Work in B' }, 'room-other')
  assert.equal(access.projectBriefQueue.length, 2)
  for (const task of access.projectBriefQueue) {
    await access.snapshotUnread(token, task.conversationId, true)
    assert.equal(access.turnWorkspaceContext.workspace.path, task.conversationId === 'room-a' ? '/repo-a' : '/repo-b')
    assert.equal(task.brief.body, task.conversationId === 'room-a' ? 'Work in A' : 'Work in B')
  }
})

test('[integration] project turns use their Git directory and resume only that repository session across switches', async () => {
  const token = await seedProjectAgent()
  const root = await mkdtemp(join(tmpdir(), 'cumora-project-run-'))
  const originalPath = process.env.PATH
  try {
    const home = join(root, 'agent-home')
    const bin = join(root, 'bin')
    const sessions = join(root, 'sessions')
    const repoA = join(root, 'repo-a')
    const repoB = join(root, 'repo-b')
    await Promise.all([mkdir(bin), mkdir(join(home, 'memory'), { recursive: true }), mkdir(repoA), mkdir(repoB)])
    for (const repo of [repoA, repoB]) {
      await execFileP('git', ['init', repo])
      await writeFile(join(repo, 'AGENTS.md'), 'Existing repository instructions.\n')
      await writeFile(join(repo, 'user-file.txt'), 'uncommitted user content')
    }
    const gitConfig = await readFile(join(repoA, '.git', 'config'))
    // A deterministic local engine performs real file writes and refuses a
    // resume from another cwd; this exposes cross-project session contamination.
    const engine = join(bin, 'engine.cjs')
    await writeFile(engine, `
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
let prompt = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s => prompt += s);
process.stdin.on('end', () => {
  const cwd = process.cwd(), dbFile = ${JSON.stringify(join(root, 'engine-sessions.json'))};
  const db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : {};
  const at = process.argv.indexOf('--session'); const sid = at < 0 ? crypto.randomUUID() : process.argv[at + 1];
  if (db[sid] && db[sid] !== cwd) { process.stderr.write('wrong repository resume'); process.exitCode = 1; return; }
  db[sid] = cwd; fs.writeFileSync(dbFile, JSON.stringify(db));
  fs.writeFileSync(path.join(cwd, 'agent-output.md'), 'project output');
  fs.writeFileSync(path.join(process.env.CUMORA_AGENT_HOME, 'memory', 'note.md'), 'personal memory');
  process.stdout.write(JSON.stringify({ type: 'text', sessionID: sid, part: { text: 'done' } }) + '\\n');
});`)
    if (process.platform === 'win32') await writeFile(join(bin, 'mimo.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0engine.cjs" %*\r\n`)
    else {
      await writeFile(join(bin, 'mimo'), `#!/bin/sh\nexec "${process.execPath}" "${engine}" "$@"\n`)
      await chmod(join(bin, 'mimo'), 0o755)
    }
    const runner = new AgentRunner({ serverUrl: base, computerId: 'pc-a', deviceToken: 'unused' }, {
      id: 'agent-a', name: 'Agent', role: null, systemPrompt: null, engine: 'mimo', model: null, fastModel: null, projectWorkspaces: true,
    }, 'mimo')
    const access = runner as unknown as {
      turnWorkspaceContext: { projectId: string; workspace: ProjectWorkspace }
      runWithSessionRecovery(prompt: string): Promise<EngineRunResult>
      projectSessionStore: EngineSessionStore
    }
    Object.assign(runner, { home, binDir: join(home, 'bin'), sessionsDir: sessions,
      sessionStore: new EngineSessionStore(sessions, 'agent-a', 'mimo'), token })
    process.env.PATH = `${bin}${delimiter}${originalPath ?? ''}`
    const bindRoot = async (directory: string) => {
      const binding = await bindProjectWorkspace({ projectId: 'project-a', computerId: 'pc-a', companyId: 'co-a', userId: 'owner-a', path: directory })
      assert.ok(binding)
      return binding
    }
    const bindingA = await bindRoot(repoA)
    await pool.query(`INSERT INTO projects (id, company_id, name) VALUES ('project-other', 'co-a', 'Other')`)
    await pool.query(`INSERT INTO conversations (id, company_id, kind, title, project_id, members) VALUES
      ('room-other', 'co-a', 'group', 'Other', 'project-other', '["agent-a"]')`)
    const bindingB = await bindProjectWorkspace({ projectId: 'project-other', computerId: 'pc-a', companyId: 'co-a', userId: 'owner-a', path: repoB })
    assert.ok(bindingB)
    access.turnWorkspaceContext = { projectId: 'project-a', workspace: bindingA }
    const first = await access.runWithSessionRecovery('Write project output')
    assert.equal(first.exitCode, 0, first.error)
    access.turnWorkspaceContext = { projectId: 'project-other', workspace: bindingB }
    const second = await access.runWithSessionRecovery('Write other project output')
    assert.equal(second.exitCode, 0, second.error)
    assert.notEqual(first.sessionId, second.sessionId)
    access.turnWorkspaceContext = { projectId: 'project-a', workspace: bindingA }
    const resumed = await access.runWithSessionRecovery('Continue the first project')
    assert.equal(resumed.exitCode, 0, resumed.error)
    assert.equal(resumed.sessionId, first.sessionId)
    await access.projectSessionStore.flush()
    access.turnWorkspaceContext = { projectId: 'project-a', workspace: { ...bindingA, path: join(root, 'missing') } }
    await assert.rejects(access.runWithSessionRecovery('Do not fall back to another directory'))
    assert.equal(await readFile(join(repoA, 'agent-output.md'), 'utf8'), 'project output')
    assert.equal(await readFile(join(repoB, 'agent-output.md'), 'utf8'), 'project output')
    assert.equal(await readFile(join(home, 'memory', 'note.md'), 'utf8'), 'personal memory')
    assert.equal(await readFile(join(repoA, 'AGENTS.md'), 'utf8'), 'Existing repository instructions.\n')
    assert.equal(await readFile(join(repoA, 'user-file.txt'), 'utf8'), 'uncommitted user content')
    assert.deepEqual(await readFile(join(repoA, '.git', 'config')), gitConfig)
  } finally {
    process.env.PATH = originalPath
    await rm(root, { recursive: true, force: true })
  }
})
