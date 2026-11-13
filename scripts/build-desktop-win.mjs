import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('Windows desktop packaging requires Windows')
const root = fileURLToPath(new URL('../', import.meta.url))
const run = (script, args) => {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    // Explicit empty values override both the caller's environment and Vite .env files.
    cwd: root, env: { ...process.env, VITE_CUMORA_API_BASE: '' }, stdio: 'inherit', windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const temporary = path.join(root, '.local', 'desktop-release')
mkdirSync(temporary, { recursive: true })
// Keep the running local-trial dist (including its private login page) intact.
run('node_modules/vite/bin/vite.js', ['build', '--outDir', '.local/desktop-release/dist'])
const config = { ...JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).build, extends: null }
config.files = config.files.map((entry) => entry === 'dist/**/*'
  ? { from: '.local/desktop-release/dist', to: 'dist', filter: ['**/*'] } : entry)
config.electronDist = path.join(root, 'node_modules', 'electron', 'dist')
const configFile = path.join(temporary, 'electron-builder.json')
writeFileSync(configFile, JSON.stringify(config, null, 2))
run('node_modules/electron-builder/cli.js', ['--win', '--publish', 'never', '--config', configFile,
  ...(process.argv.includes('--dir') ? ['--dir'] : [])])
