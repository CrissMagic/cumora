import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { getAdapter } from '../agents/computer/engine.js'

test('Windows cancellation waits until the fake model and its tool child have both exited', { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cumora-windows-cancel-'))
  const bin = join(root, 'bin'), home = join(root, 'home'), pidFile = join(root, 'pids.json')
  const savedPath = process.env.PATH
  const savedCompatibility = process.env.CUMORA_BYOA_ALLOW_UNSANDBOXED
  const controller = new AbortController()
  let pids: number[] = []
  let run: ReturnType<ReturnType<typeof getAdapter>['run']> | undefined
  try {
    await mkdir(bin); await mkdir(home)
    await writeFile(join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0fake.cjs" %*\r\n`)
    await writeFile(join(bin, 'fake.cjs'), `
      const { spawn } = require('node:child_process')
      const { writeFileSync } = require('node:fs')
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true })
      writeFileSync(process.env.CANCEL_TEST_PID_FILE, JSON.stringify([process.pid, child.pid]))
      setInterval(() => {}, 120000)
    `)
    process.env.PATH = `${bin}${delimiter}${savedPath ?? ''}`
    // The fixture has no sandbox implementation; this flag is confined to this
    // test process, and the model CLI is our local script with no model calls.
    process.env.CUMORA_BYOA_ALLOW_UNSANDBOXED = '1'
    run = getAdapter('claude').run({
      home, prompt: 'test cancellation', signal: controller.signal, onLog() {},
      env: { ...process.env, CLAUDE_CONFIG_DIR: join(root, 'empty-config'), CANCEL_TEST_PID_FILE: pidFile },
    })
    const deadline = Date.now() + 8000
    while (!pids.length && Date.now() < deadline) {
      try { pids = JSON.parse(await readFile(pidFile, 'utf8')) } catch { await new Promise((r) => setTimeout(r, 20)) }
    }
    assert.equal(pids.length, 2, 'the fake model must launch its own tool child')
    controller.abort()
    const result = await run
    assert.notEqual(result.exitCode, 0)
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH')
  } finally {
    controller.abort()
    if (run) await run.catch(() => {})
    // Kill only the PIDs created and recorded by this fixture if an assertion
    // failed before the adapter's cancellation path could finish.
    for (const pid of pids) await promisify(execFile)(join(process.env.SystemRoot!, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/t', '/f'], { windowsHide: true }).catch(() => {})
    if (savedPath === undefined) delete process.env.PATH
    else process.env.PATH = savedPath
    if (savedCompatibility === undefined) delete process.env.CUMORA_BYOA_ALLOW_UNSANDBOXED
    else process.env.CUMORA_BYOA_ALLOW_UNSANDBOXED = savedCompatibility
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}cumora-windows-cancel-`))
    await rm(root, { recursive: true, force: true })
  }
})
