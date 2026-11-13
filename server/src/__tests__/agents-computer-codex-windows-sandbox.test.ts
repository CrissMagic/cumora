import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { codexSecureConfigOverrides } from '../agents/computer/engine.js'

// Opt-in integration test against a real, provisioned Windows Codex sandbox.
// No model requests, cloud messages, credentials in output or installer/setup.
const binary = process.env.CUMORA_TEST_CODEX_BIN
const runtime = process.env.CUMORA_TEST_CODEX_HOME
const enabled = process.platform === 'win32' && !!binary && !!runtime

test('Windows compatibility reading starts commands while workspace writes, read-only probes and network remain bounded',
  { skip: !enabled, timeout: 90_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'cumora-win-sandbox-'))
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside.txt')
    const own = join(workspace, 'project.txt')
    const agentHome = join(root, 'agent-home')
    const agentFile = join(agentHome, 'agent.txt')
    await mkdir(workspace)
    await mkdir(agentHome)
    await writeFile(own, 'project-fixture')
    await writeFile(agentFile, 'agent-fixture')
    await writeFile(outside, 'outside-fixture')
    const script = join(workspace, 'probe.ps1')
    await writeFile(script, `
param([string]$ProjectFile, [string]$AgentFile, [string]$OutsideFile, [int]$Port)
$ErrorActionPreference = 'Stop'
$projectRead = [IO.File]::ReadAllText($ProjectFile)
$outsideRead = [IO.File]::ReadAllText($OutsideFile)
$projectWrite = $false
try { [IO.File]::WriteAllText($ProjectFile, 'updated-project'); $projectWrite = $true } catch {}
$agentWrite = $false
try { [IO.File]::WriteAllText($AgentFile, 'updated-agent'); $agentWrite = $true } catch {}
$outsideWrite = $false
try { [IO.File]::WriteAllText($OutsideFile, 'unexpected-write'); $outsideWrite = $true } catch {}
$network = $false
$socket = $null
try { $socket = [Net.Sockets.TcpClient]::new(); $connect = $socket.ConnectAsync('127.0.0.1', $Port); if ($connect.Wait(2000)) { $network = $socket.Connected } } catch {} finally { if ($socket) { $socket.Dispose() } }
@{ projectRead = $projectRead; outsideRead = $outsideRead; projectWrite = $projectWrite; agentWrite = $agentWrite; outsideWrite = $outsideWrite; network = $network } | ConvertTo-Json -Compress
`, 'utf8')
    const server = createServer((socket) => socket.end())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const port = address.port
    const env = { ...process.env, CUMORA_CODEX_WINDOWS_READ_COMPAT: '1' }
    const run = async (readOnly: boolean, compatibility = true) => {
      const overrides = codexSecureConfigOverrides({ home: workspace,
        env: { ...env, CUMORA_AGENT_HOME: agentHome, CUMORA_CODEX_WINDOWS_READ_COMPAT: compatibility ? '1' : undefined,
          CUMORA_AGENT_MCP_SHIM: join(root, 'unused-mcp.cjs'), CUMORA_AGENT_IPC_DIR: join(root, 'ipc') } }, readOnly)
        .filter((value) => value !== '--strict-config') // `sandbox` rejects this exec-only validation flag.
      return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(binary!, [...overrides, 'sandbox', '--cd', workspace, '--permission-profile', 'cumora', '--',
          process.env.CUMORA_TEST_PWSH_BIN || 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', '-NoProfile', '-File', script,
          '-ProjectFile', own, '-AgentFile', agentFile, '-OutsideFile', outside, '-Port', String(port)], {
          env: { ...env, CODEX_HOME: runtime }, windowsHide: true, timeout: 25_000,
        })
        let stdout = '', stderr = ''
        child.stdout.on('data', (chunk) => { stdout += chunk })
        child.stderr.on('data', (chunk) => { stderr += chunk })
        child.once('error', reject)
        child.once('close', (code) => resolve({ code, stdout, stderr }))
      })
    }
    try {
      const rejected = await run(false, false)
      assert.notEqual(rejected.code, 0)
      assert.match(rejected.stderr, /requires effective `:root` read access/)
      const main = await run(false)
      assert.equal(main.code, 0, main.stderr)
      assert.deepEqual(JSON.parse(main.stdout.trim()), { projectRead: 'project-fixture', outsideRead: 'outside-fixture', projectWrite: true, agentWrite: true, outsideWrite: false, network: false })
      assert.equal(await readFile(outside, 'utf8'), 'outside-fixture')
      const probe = await run(true)
      assert.equal(probe.code, 0, probe.stderr)
      assert.deepEqual(JSON.parse(probe.stdout.trim()), { projectRead: 'updated-project', outsideRead: 'outside-fixture', projectWrite: false, agentWrite: false, outsideWrite: false, network: false })
      assert.equal(await readFile(own, 'utf8'), 'updated-project')
      assert.equal(await readFile(agentFile, 'utf8'), 'updated-agent')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      // This generated, test-owned directory is the only recursive cleanup target.
      await rm(root, { recursive: true, force: true })
    }
  })
