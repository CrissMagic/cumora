/** Exercise the real local server → daemon → engine → directory → reply chain. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root = resolve('.local')
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8')) as { port: number }
const trial = JSON.parse(await readFile(join(root, 'trial.json'), 'utf8')) as { conversationId: string; directory: string; workspacePath?: string; agentId: string; projectId: string }
const session = JSON.parse(await readFile(join(root, 'session.json'), 'utf8')) as { token: string; companyId: string }
assert.equal(resolve(trial.directory), join(root, 'project'), 'Smoke writes are restricted to the dedicated trial directory')
const base = `http://127.0.0.1:${config.port}/api`
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: {
      authorization: `Bearer ${session.token}`, 'x-company-id': session.companyId, 'content-type': 'application/json',
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  assert.ok(response.ok, `${path}: ${response.status} ${response.ok ? '' : await response.text()}`)
  return response.json() as Promise<T>
}
const workspaces = await api<{ workspaces: Array<{ path: string; status: string }> }>(`/projects/${trial.projectId}/workspaces`)
assert.ok(workspaces.workspaces.some((workspace) => workspace.path === (trial.workspacePath ?? trial.directory) && workspace.status === 'ready'), 'The trial directory must be validated on the assigned PC')
const marker = `local-smoke-${randomUUID()}`
const fileName = `${marker}.md`
await api(`/conversations/${trial.conversationId}/messages`, {
  body: `@${trial.agentId} 这是本地联调测试。请在当前项目工作目录直接创建 ${fileName}，文件只包含 ${marker}。不要修改其他文件。成功后在此对话回复包含 ${marker} 的简短确认。`,
  clientId: marker,
})
console.log('Smoke task queued; waiting for the real local engine to create the file and reply…')
const deadline = Date.now() + 180_000
while (Date.now() < deadline) {
  const content = await readFile(join(trial.directory, fileName), 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return ''
  })
  const messages = await api<Array<{ authorId?: string; author_id?: string; body?: string }>>(`/conversations/${trial.conversationId}/messages`)
  const reply = messages.find((message) => (message.authorId ?? message.author_id) === trial.agentId && message.body?.includes(marker))
  if (content.trim() === marker && reply) {
    const result = { passed: true, at: new Date().toISOString(), conversationId: trial.conversationId, file: join(trial.directory, fileName), marker }
    await writeFile(join(root, 'smoke-result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log('PASS: real engine wrote the bound project file and replied through the local server.')
    break
  }
  if (Date.now() + 2000 >= deadline) throw new Error('Timed out waiting for both the bound-directory output and agent reply; inspect .local/logs/agent.log')
  await new Promise((resolve) => setTimeout(resolve, 2000))
}
