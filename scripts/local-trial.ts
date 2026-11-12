/** Local operator CLI only. No authentication bypass is added to the server. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { hostname } from 'node:os'
import { resolve, join } from 'node:path'
import { pool } from '../server/src/db/pool.js'
import { createSession } from '../server/src/auth.js'
import { redis, sub } from '../server/src/redis.js'

const root = resolve('.local')
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8')) as { lanAddress: string; port: number }
const db = new URL(process.env.DATABASE_URL ?? '')
if (db.hostname !== '127.0.0.1' || db.pathname !== '/cumora_local' || db.port !== '15433') {
  throw new Error('This bootstrap is restricted to the isolated local-PC database')
}
const origin = `http://${config.lanAddress}:${config.port}`
const base = `http://127.0.0.1:${config.port}`
const userId = 'local-pc-owner'
const companyId = 'local-pc-trial'
interface Trial { agentId: string; projectId: string; conversationId: string; directory: string }
const trialPath = join(root, 'trial.json')

async function privateJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await chmod(path, 0o600)
}

async function run() {
  const action = process.argv[2]
  if (action !== 'setup' && action !== 'login') throw new Error('Use setup or login')
  if (action === 'setup') {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO users (id, email, display_name, tier, email_verified_at)
        VALUES ($1, 'local-pc@cumora.local', '本地试用', 'pro', NOW()) ON CONFLICT (id) DO NOTHING`, [userId])
      await client.query(`INSERT INTO companies (id, name, slug, owner_user_id, starter_seeded_at, starter_dms_seeded_at, all_hands_seeded_at)
        VALUES ($1, '本地 PC 试用', 'local-pc-trial', $2, NOW(), NOW(), NOW()) ON CONFLICT (id) DO NOTHING`, [companyId, userId])
      await client.query(`INSERT INTO company_members(company_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, [companyId, userId])
      await client.query(`INSERT INTO participants(id, company_id, kind, name, initial, avatar_bg, status)
        VALUES ($1, $2, 'human', '本地试用', '本', '#4d92c6', 'avail') ON CONFLICT (company_id, id) DO NOTHING`, [userId, companyId])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }
  const session = await createSession(userId, { ip: '127.0.0.1', ua: 'local-pc operator CLI' })
  await privateJson(join(root, 'session.json'), { token: session.token, userId, companyId, expiresAt: session.expiresAt })
  async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { authorization: `Bearer ${session.token}`, 'x-company-id': companyId, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
    return response.json() as Promise<T>
  }
  if (action === 'setup') {
    const deviceFile = join(root, 'agent', 'computer.json')
    let computer: { computerId: string; serverUrl: string }
    try { computer = JSON.parse(await readFile(deviceFile, 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const { code } = await api<{ code: string }>('/computers', {})
      const paired = await api<{ computerId: string; deviceToken: string }>('/computers/pair', {
        code, hostName: `${hostname()} (local trial)`, engines: ['codex'], supervised: true, unsandboxed: false,
      })
      computer = { ...paired, serverUrl: base }
      await privateJson(deviceFile, computer)
    }
    if (computer.serverUrl !== base) throw new Error('Local daemon config points at a different service')
    let trial: Partial<Trial> = {}
    try { trial = JSON.parse(await readFile(trialPath, 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!trial.agentId) {
      const agent = await api<{ id: string }>('/agents', {
        requestId: 'local-pc-trial-agent', name: '本地 Codex', role: '本地开发助手', engine: 'codex', computerId: computer.computerId,
        systemPrompt: '使用中文协作，按用户授权完成项目任务。保护已有文件和未提交改动。先检查实际工作目录，完成任务后在对话中报告结果。',
      })
      trial.agentId = agent.id
      await privateJson(trialPath, trial)
    }
    if (!trial.projectId) {
      const project = await api<{ id: string }>('/projects', { name: '本地目录试用', description: '手机发任务，PC 在绑定目录执行' })
      trial.projectId = project.id
      await privateJson(trialPath, trial)
    }
    trial.directory ??= join(root, 'project')
    await mkdir(trial.directory, { recursive: true })
    // Preserve an existing binding, including any directory the user selected.
    const workspaces = await api<{ workspaces: Array<{ computerId: string }> }>(`/projects/${trial.projectId}/workspaces`, undefined, 'GET')
    if (!workspaces.workspaces.some((workspace) => workspace.computerId === computer.computerId)) {
      await api(`/projects/${trial.projectId}/workspaces/${computer.computerId}`, { path: trial.directory }, 'PUT')
    }
    if (!trial.conversationId) {
      const room = await api<{ id: string }>('/conversations', { title: 'PC 与手机联调', members: [trial.agentId], projectId: trial.projectId })
      trial.conversationId = room.id
    }
    await privateJson(trialPath, trial)
  }
  const fragment = new URLSearchParams({ token: session.token, companyId }).toString()
  const previous = JSON.parse(await readFile(join(root, 'access.json'), 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return '{}'
  })) as { pageName?: string }
  // Keep the private bookmark stable across credential refreshes and builds.
  // Retain an unguessable filename rather than exposing a predictable login URL.
  const pageName = previous.pageName && /^local-access-[a-f0-9-]+\.html$/.test(previous.pageName)
    ? previous.pageName
    : `local-access-${randomUUID()}.html`
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta http-equiv="Cache-Control" content="no-store"><title>Cumora 本地试用</title>
<style>body{font:17px system-ui;max-width:620px;margin:48px auto;padding:20px;background:#f8fafc;color:#162537}a{display:block;background:#1965ad;color:white;padding:16px;margin:20px 0;border-radius:10px;text-decoration:none}</style>
<h1>Cumora 本地试用</h1><p>此页面包含本地试用账号的登录凭证，仅在自己的设备打开。</p>
<a href="/${'#' + fragment}">在 PC 或手机浏览器登录</a>
<a href="cumora://auth#${fragment}">登录已安装的 Android App</a>
<a href="/local-trial.apk" download>下载 Android 调试 APK</a>
<p>先安装 App 并打开一次，再返回此页点击 App 登录。进入“PC 与手机联调”对话即可试用；PC 需要保持开机。</p></html>`
  await writeFile(resolve('dist', pageName), html, { mode: 0o600 })
  await privateJson(join(root, 'access.json'), { pageName, url: `${origin}/${pageName}`, expiresAt: session.expiresAt })
  console.log('Local session created. Private login URL is saved in .local/access.json (not printed in logs).')
}
try { await run() }
finally { redis.disconnect(); sub.disconnect(); await pool.end() }
