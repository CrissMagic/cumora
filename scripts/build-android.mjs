import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Web build and `cap sync android` run first via npm's android:build script.
const windows = process.platform === 'win32'
const result = spawnSync(windows ? process.env.ComSpec || 'cmd.exe' : 'sh',
  windows
    ? ['/d', '/s', '/c', 'gradlew.bat --no-daemon assembleDebug']
    : ['./gradlew', '--no-daemon', 'assembleDebug'], {
    cwd: fileURLToPath(new URL('../android/', import.meta.url)),
    stdio: 'inherit',
    windowsHide: true,
  })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
