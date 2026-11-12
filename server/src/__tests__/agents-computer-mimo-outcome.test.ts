import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { getAdapter, type EngineHopReport } from '../agents/computer/engine.js'

// Exercise outcome/accounting with a deterministic local process. CLI syntax
// is verified against the vendor separately; these tests assert user outcomes.
async function runFixture(events: unknown[], stream: 'stdout' | 'stderr' = 'stdout') {
  const root = await mkdtemp(join(tmpdir(), 'cumora-mimo-outcome-'))
  try {
    const bin = join(root, 'bin')
    await mkdir(bin)
    const source = join(bin, 'fixture.cjs')
    await writeFile(source, `process.stdin.resume(); process.stdin.on('end', () => {
      for (const event of ${JSON.stringify(events)}) process.${stream}.write(JSON.stringify(event) + '\\n');
    });`)
    if (process.platform === 'win32') {
      await writeFile(join(bin, 'mimo.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0fixture.cjs" %*\r\n`)
    } else {
      await writeFile(join(bin, 'mimo'), `#!/bin/sh\nexec "${process.execPath}" "${source}" "$@"\n`)
      await chmod(join(bin, 'mimo'), 0o755)
    }
    const hops: EngineHopReport[] = []
    const result = await getAdapter('mimo').run({ home: root, prompt: 'run task',
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` },
      onLog: () => {}, onHopUsage: (hop) => hops.push(hop), signal: AbortSignal.timeout(5000),
    })
    return { result, hops }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('MiMo provider errors fail the task even when the process exits zero', async () => {
  const { result } = await runFixture([{ type: 'error', error: { data: { message: 'model unavailable' } } }])
  assert.equal(result.exitCode, 1)
  assert.match(result.error ?? '', /model unavailable/)
})

test('MiMo sessions and per-hop usage keep their own engine identity', async () => {
  const { result, hops } = await runFixture([
    { type: 'step_start', sessionID: 'mimo-session' },
    { type: 'text', part: { text: 'done' } },
    { type: 'step_finish', part: { tokens: { input: 7, output: 3, reasoning: 2, cache: { read: 11 } } } },
  ])
  assert.equal(result.exitCode, 0, result.error)
  assert.equal(result.sessionId, 'mimo-session')
  assert.equal(hops.length, 1)
  assert.equal(hops[0].model, 'mimo')
  assert.equal(result.usage?.input_tokens, 7)
  assert.equal(result.usage?.output_tokens, 5)
  assert.equal(result.usage?.cache_read_input_tokens, 11)
})

test('MiMo stderr cannot inject a provider failure or change the session and ledger', async () => {
  const { result, hops } = await runFixture([
    { type: 'error', sessionID: 'wrong-session', error: 'diagnostic only' },
    { type: 'step_finish', part: { tokens: { input: 999 } } },
  ], 'stderr')
  assert.equal(result.exitCode, 0, result.error)
  assert.equal(result.sessionId, null)
  assert.equal(result.usage, undefined)
  assert.equal(hops.length, 0)
})
