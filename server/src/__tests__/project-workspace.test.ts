import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { projectWorkspacePath, selectProjectInbox, type ProjectWorkspace } from '../../../shared/project-workspaces.js'
import { inspectProjectWorkspace, withProjectWorkspaceLock } from '../agents/computer/project-workspace.js'

const git = promisify(execFile)
const binding = (path: string, id = 'binding-a'): ProjectWorkspace => ({
  id, path, projectId: 'project-a', computerId: 'computer-a', status: 'pending', error: null, isGit: null, checkedAt: null,
})

test('directory input refuses relative, traversing and Git metadata paths without changing valid absolute paths', () => {
  for (const path of ['repo', '~/repo', 'C:repo', '/repo/../other', 'E:\\repo\\.git', '/', 'C:\\', '/repo\nother']) {
    assert.throws(() => projectWorkspacePath(path))
  }
  assert.equal(projectWorkspacePath(' E:\\开发\\repo '), 'E:\\开发\\repo')
  assert.equal(projectWorkspacePath('/home/team/repo'), '/home/team/repo')
})

test('project routing separates mixed unread work and retains failed projects for a later poll', () => {
  const rows = [
    { id: 'a', project_id: 'a', conversation_id: 'room-a' },
    { id: 'b', project_id: 'b', conversation_id: 'room-b' },
    { id: 'a2', project_id: 'a', conversation_id: 'room-a' },
    { id: 'dm', project_id: null, conversation_id: 'dm' },
  ]
  const contexts = [{ projectId: 'a', workspace: binding('/repo') }]
  const attempted = new Set<string | null>()
  const first = selectProjectInbox(rows, contexts, 'room-b', attempted)
  assert.deepEqual(first.rows.map((row) => row.id), ['b'])
  attempted.add(first.projectId) // b failed; do not ACK it, but do not spin on it.
  const next = selectProjectInbox(rows, contexts, undefined, attempted)
  assert.deepEqual(next.rows.map((row) => row.id), ['a', 'a2'])
  attempted.add(next.projectId)
  assert.deepEqual(selectProjectInbox(rows, contexts, undefined, attempted).rows.map((row) => row.id), ['dm'])
  attempted.add(null)
  assert.equal(selectProjectInbox(rows, contexts, undefined, attempted).exhausted, true)
  assert.equal(selectProjectInbox(rows, [], undefined, attempted).rows.length, rows.length)
})

test('inspecting an existing Git repository preserves instructions, metadata and dirty files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cumora-project-inspect-'))
  try {
    await git('git', ['init', root])
    await writeFile(join(root, 'AGENTS.md'), 'Keep the existing repository rules.\n')
    await writeFile(join(root, 'dirty.txt'), 'uncommitted user work')
    const config = await readFile(join(root, '.git', 'config'))
    const before = await readdir(root)
    const first = await inspectProjectWorkspace(binding(root))
    assert.equal(first.isGit, true)
    assert.equal(first.instructions, 'Keep the existing repository rules.\n')
    assert.deepEqual(await readdir(root), before)
    assert.deepEqual(await readFile(join(root, '.git', 'config')), config)
    assert.equal(await readFile(join(root, 'dirty.txt'), 'utf8'), 'uncommitted user work')
    assert.notEqual((await inspectProjectWorkspace(binding(root, 'rebound'))).scope, first.scope)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('plain directories are usable without creating a repository; missing directories fail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cumora-project-plain-'))
  const inheritedGitDir = process.env.GIT_DIR
  try {
    const directory = join(root, 'plain')
    await mkdir(directory)
    process.env.GIT_DIR = join(root, 'nonexistent-inherited-repo')
    assert.equal((await inspectProjectWorkspace(binding(directory))).isGit, false)
    assert.deepEqual(await readdir(directory), [])
    await assert.rejects(inspectProjectWorkspace(binding(join(root, 'missing'))))
  } finally {
    if (inheritedGitDir === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = inheritedGitDir
    await rm(root, { recursive: true, force: true })
  }
})

test('agents writing the same physical workspace execute serially and an aborted waiter cannot release another agent lock', async () => {
  const order: string[] = []
  let releaseFirst!: () => void
  const barrier = new Promise<void>((resolve) => { releaseFirst = resolve })
  const first = withProjectWorkspaceLock('/repo', new AbortController().signal, async () => {
    order.push('first-start'); await barrier; order.push('first-end')
  })
  await new Promise((resolve) => setImmediate(resolve))
  const abort = new AbortController()
  const second = withProjectWorkspaceLock('/repo', abort.signal, async () => { order.push('must-not-run') })
  const rejected = assert.rejects(second)
  abort.abort()
  const third = withProjectWorkspaceLock('/repo', new AbortController().signal, async () => { order.push('third') })
  await rejected
  assert.deepEqual(order, ['first-start'])
  releaseFirst()
  await Promise.all([first, third])
  assert.deepEqual(order, ['first-start', 'first-end', 'third'])
})
