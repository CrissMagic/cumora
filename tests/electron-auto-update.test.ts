import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

function harness(supported = true) {
  const events: Array<{ status: string; detail?: string }> = []
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true,
    checkForUpdates: async () => {}, downloadUpdate: async () => {}, quitAndInstall: (..._args: unknown[]) => {},
  })
  const module = { exports: {} as {
    initialize(): void; registerIpc(): void; setBeforeInstallHandler(fn: () => void): void
  } }
  const electron = {
    app: { isPackaged: true, getName: () => 'Cumora', getVersion: () => '0.18.10', getPath: () => '/app/data' },
    BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_channel: string, value: { status: string }) => events.push(value) } }] },
    ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn) },
  }
  const filename = new URL('../electron/autoUpdater.cjs', import.meta.url)
  vm.runInNewContext(readFileSync(filename, 'utf8'), {
    module, console: { log() {}, warn() {}, error() {} },
    require: (id: string) => {
      if (id === 'electron') return electron
      if (id === 'electron-updater') return { autoUpdater: updater }
      if (id === 'node:fs') return { existsSync: () => supported }
      if (id === 'node:path') return path
      throw new Error(`Unexpected module: ${id}`)
    },
    process: { platform: 'win32', resourcesPath: '/app/resources' },
    setTimeout() {}, setInterval() {},
  })
  module.exports.registerIpc()
  module.exports.initialize()
  return { updater, events, handlers, host: module.exports }
}

test('desktop updates do not download, install, downgrade or accept prereleases implicitly', () => {
  const { updater } = harness()
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowDowngrade, false)
  assert.equal(updater.allowPrerelease, false)
})

test('checking exposes availability and a verified download can install after host cleanup', async () => {
  const { updater, handlers, host, events } = harness()
  updater.checkForUpdates = async () => { updater.emit('update-available', { version: '0.18.11' }) }
  const result = await handlers.get('update:check')!() as { status: string }
  assert.equal(result.status, 'update-available')
  assert.equal(events.at(-1)?.status, 'update-available')
  const order: string[] = []
  host.setBeforeInstallHandler(() => { order.push('cleanup') })
  updater.quitAndInstall = (silent, restart) => { assert.equal(silent, false); assert.equal(restart, true); order.push('install') }
  const premature = handlers.get('update:install')!() as { ok: boolean }
  assert.equal(premature.ok, false)
  assert.equal(order.length, 0)
  updater.emit('update-downloaded', { version: '0.18.11' })
  const installed = handlers.get('update:install')!() as { ok: boolean }
  assert.equal(installed.ok, true)
  assert.deepEqual(order, ['cleanup', 'install'])
})

test('check failures are retryable and an installation exception is reported as failure', async () => {
  const { updater, handlers, events } = harness()
  updater.checkForUpdates = async () => { throw new Error('offline') }
  assert.equal((await handlers.get('update:check')!() as { status: string }).status, 'error')
  updater.checkForUpdates = async () => { updater.emit('update-not-available', { version: '0.18.10' }) }
  assert.equal((await handlers.get('update:check')!() as { status: string }).status, 'update-not-available')
  updater.emit('update-downloaded', { version: '0.18.11' })
  updater.quitAndInstall = () => { throw new Error('installer refused') }
  const failed = handlers.get('update:install')!() as { ok: boolean; error: string }
  assert.equal(failed.ok, false)
  assert.equal(failed.error, 'installer refused')
  assert.equal(events.at(-1)?.status, 'error')
})

test('a build without update metadata cannot install or run cleanup', () => {
  const { handlers, host } = harness(false)
  host.setBeforeInstallHandler(() => { throw new Error('must not run') })
  assert.equal((handlers.get('update:install')!() as { ok: boolean }).ok, false)
})

test('an SDK error event during installation is not acknowledged as success', () => {
  const { updater, handlers } = harness()
  updater.emit('update-downloaded', { version: '0.18.11' })
  updater.quitAndInstall = () => { updater.emit('error', new Error('downloaded installer is missing')) }
  const failed = handlers.get('update:install')!() as { ok: boolean; error: string }
  assert.equal(failed.ok, false)
  assert.equal(failed.error, 'downloaded installer is missing')
})
