import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { listPackage, extractFile } from '@electron/asar'

const root = fileURLToPath(new URL('../', import.meta.url))
const version = JSON.parse(readFileSync(path.join(root, 'package.json'))).version
const directory = path.join(root, 'release')
const filename = `Cumora-Setup-${version}.exe`
const installer = path.join(directory, filename)
const metadata = yaml.load(readFileSync(path.join(directory, 'latest.yml'), 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
assert(metadata.version === version, 'latest.yml version differs from package.json')
assert(statSync(installer).size > 1024 * 1024, 'Installer is missing or incomplete')
assert(existsSync(`${installer}.blockmap`), 'Installer blockmap is missing')
const hash = createHash('sha512').update(readFileSync(installer)).digest('base64')
const entry = metadata.files?.find((file) => file.url === filename)
assert(entry?.sha512 === hash && metadata.sha512 === hash, 'Update metadata does not match installer SHA-512')
assert(entry.size === statSync(installer).size && metadata.path === filename, 'Update metadata points at another artifact')
const resources = path.join(directory, 'win-unpacked', 'resources')
const feed = yaml.load(readFileSync(path.join(resources, 'app-update.yml'), 'utf8'))
assert(feed.provider === 'github' && feed.owner === 'CrissMagic' && feed.repo === 'cumora', 'Packaged update feed does not point at this fork')
const asar = path.join(resources, 'app.asar')
const files = listPackage(asar).map((filename) => filename.replaceAll('\\', '/'))
assert(!files.some((name) => /^\/node_modules\/@capacitor(?:\/|$)/.test(name)), 'Desktop package contains Capacitor / Android dependencies')
assert(!files.some((name) => /^\/(?:\.local|android|ios|server)(?:\/|$)/.test(name)), 'Desktop package contains non-desktop source or local state')
assert(files.includes('/electron/tray-icon.cjs') && files.includes('/build/icon.png'), 'Desktop icons are missing')
assert(JSON.parse(extractFile(asar, 'package.json')).version === version, 'Packaged app version differs from installer')
console.log(JSON.stringify({ version, installer: filename, bytes: statSync(installer).size, sha512: hash,
  updateFeed: 'https://github.com/CrissMagic/cumora/releases', capacitorIncluded: false }))
