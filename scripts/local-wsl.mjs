import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'

assert.equal(process.platform, 'linux', 'Run this helper inside the selected WSL distribution')
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const local = join(repo, '.local')
const config = JSON.parse(await readFile(join(local, 'config.json'), 'utf8'))
// Keep this private state on the same Windows volume as the existing login,
// so Codex's normal hard-link sharing follows credential refresh atomically.
const home = config.wslState ?? join(local, 'agent-wsl')
const packages = config.wslPackages ?? join(local, 'wsl')
const origin = `http://${config.lanAddress}:${config.port}`
const action = process.argv[2]

if (action === 'install') {
  for (const command of ['git', 'bwrap']) {
    assert.equal(spawnSync('which', [command]).status, 0, `${command} is required in WSL`)
  }
  assert.equal(spawnSync('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--', '/bin/true']).status, 0, 'WSL must permit sandbox namespaces')
  await mkdir(packages, { recursive: true })
  const installed = await readFile(join(packages, 'node_modules/@openai/codex/package.json'), 'utf8').catch(() => '{}')
  if (JSON.parse(installed).version !== '0.166.0') {
    const result = spawnSync('npm', ['install', '--prefix', packages, '--no-audit', '--no-fund', '@openai/codex@0.166.0'], { stdio: 'inherit' })
    assert.equal(result.status, 0, 'Local WSL Codex installation failed')
  }
  await mkdir(home, { recursive: true })
  const provider = JSON.parse(await readFile(join(local, 'wsl-provider.json'), 'utf8'))
  const codexHome = join(home, 'codex-runtime')
  await mkdir(codexHome, { recursive: true })
  await writeFile(join(codexHome, 'config.toml'), provider.settings.join('\n') + '\n', { mode: 0o600 })
  if (provider.catalog) await writeFile(join(codexHome, 'models.json'), provider.catalog, { mode: 0o600 })
  const device = JSON.parse(await readFile(join(local, 'agent/computer.json'), 'utf8'))
  await writeFile(join(home, 'computer.json'), JSON.stringify({ ...device, serverUrl: origin }, null, 2), { mode: 0o600 })
  const trialPath = join(local, 'trial.json')
  const trial = JSON.parse(await readFile(trialPath, 'utf8'))
  const session = JSON.parse(await readFile(join(local, 'session.json'), 'utf8'))
  const headers = { authorization: `Bearer ${session.token}`, 'x-company-id': session.companyId, 'content-type': 'application/json' }
  const endpoint = `${origin}/api/projects/${trial.projectId}/workspaces`
  const current = await fetch(endpoint, { headers })
  assert.ok(current.ok, `Cannot inspect trial binding: ${current.status}`)
  const bindings = await current.json()
  const bound = bindings.workspaces.find((workspace) => workspace.computerId === device.computerId)
  assert.ok(bound && [trial.directory, join(local, 'project')].includes(bound.path), 'Refusing to change a user-selected directory; only the original trial binding can be converted')
  const workspacePath = join(local, 'project')
  const response = await fetch(`${endpoint}/${device.computerId}`, { method: 'PUT', headers, body: JSON.stringify({ path: workspacePath }) })
  assert.ok(response.ok, `Cannot configure WSL path: ${response.status}`)
  await writeFile(trialPath, JSON.stringify({ ...trial, workspacePath }, null, 2) + '\n', { mode: 0o600 })
  console.log('Installed an isolated Linux Codex and mapped the original trial directory through WSL.')
} else if (action === 'start') {
  process.chdir(repo)
  let proxy = config.wslProxy
  let relay
  const connections = new Set()
  if (config.wslProxyRelay) {
    const windowsNode = config.nodePath.replace(/^([a-z]):/i, (_, drive) => `/mnt/${drive.toLowerCase()}`).replaceAll('\\', '/')
    const helper = config.windowsRepo + '\\scripts\\local-proxy-tunnel.cjs'
    relay = createServer((socket) => {
      connections.add(socket)
      const tunnel = spawn(windowsNode, [helper], { stdio: ['pipe', 'pipe', 'ignore'] })
      tunnel.on('error', () => socket.destroy())
      tunnel.on('close', () => socket.destroy())
      tunnel.stdin.on('error', () => socket.destroy())
      socket.on('error', () => tunnel.kill())
      socket.on('close', () => { connections.delete(socket); tunnel.kill() })
      socket.pipe(tunnel.stdin)
      tunnel.stdout.pipe(socket)
    })
    await new Promise((resolve, reject) => { relay.once('error', reject); relay.listen(0, '127.0.0.1', resolve) })
    proxy = `http://127.0.0.1:${relay.address().port}`
    console.log('Using a WSL-loopback stdio relay to the existing Windows proxy; no host proxy port opened.')
  }
  const child = spawn(process.execPath, [join(repo, 'agent-cli/dist/cli.js'), 'agent', 'computer', '--server', origin], {
    stdio: 'inherit', env: {
      ...process.env, PATH: `${join(packages, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
      CUMORA_CONFIG_DIR: home, CUMORA_AUTO_UPDATE: '0', CUMORA_SUPERVISED: '1',
      ...(config.wslCodexSource ? { CODEX_HOME: config.wslCodexSource } : {}),
      ...(proxy ? {
        HTTPS_PROXY: proxy, HTTP_PROXY: proxy,
        https_proxy: proxy, http_proxy: proxy,
        NO_PROXY: `localhost,127.0.0.1,::1,${config.lanAddress}`,
        no_proxy: `localhost,127.0.0.1,::1,${config.lanAddress}`,
      } : {}),
    },
  })
  child.on('error', (error) => { console.error(error); process.exitCode = 1 })
  process.on('SIGTERM', () => child.kill('SIGTERM'))
  process.on('SIGINT', () => child.kill('SIGINT'))
  child.on('exit', (code) => {
    for (const socket of connections) socket.destroy()
    relay?.close()
    process.exitCode = code ?? 1
  })
} else if (action === 'stop') {
  let state
  try { state = JSON.parse(await readFile(join(home, 'running.json'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (Number.isInteger(state?.pid) && state.pid > 1) {
    let env, argv
    try {
      env = (await readFile(`/proc/${state.pid}/environ`, 'utf8')).split('\0')
      argv = (await readFile(`/proc/${state.pid}/cmdline`, 'utf8')).split('\0')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (env && argv) {
      assert.ok(env.includes(`CUMORA_CONFIG_DIR=${home}`) && argv.includes(join(repo, 'agent-cli/dist/cli.js')), 'Refusing to stop a PID not owned by this trial')
      process.kill(state.pid, 'SIGTERM')
      let exited = false
      for (let tries = 0; tries < 80; tries++) {
        try { process.kill(state.pid, 0) } catch (error) { if (error.code === 'ESRCH') { exited = true; break } throw error }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      assert.ok(exited, 'The trial daemon did not stop in 20 seconds; refusing to start a duplicate')
    }
  }
} else {
  throw new Error('Use install, start or stop')
}
