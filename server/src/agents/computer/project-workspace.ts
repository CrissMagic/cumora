import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { projectWorkspacePath, type ProjectWorkspace } from '../../../../shared/project-workspaces.js'

const execFileP = promisify(execFile)

export interface LocalProjectWorkspace {
  binding: ProjectWorkspace
  directory: string
  isGit: boolean
  instructions: string
  scope: string
}

/** Read-only inspection: never initialize Git, seed persona files or migrate content. */
export async function inspectProjectWorkspace(binding: ProjectWorkspace): Promise<LocalProjectWorkspace> {
  const path = projectWorkspacePath(binding.path)
  if (!isAbsolute(path)) throw new Error('This directory path does not belong to this computer platform')
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('The project root must be an existing directory, not a symbolic link')
  const directory = await realpath(path)
  projectWorkspacePath(directory)
  await access(directory, constants.R_OK | constants.W_OK)
  let isGit = false
  try {
    // A daemon launched from another Git worktree may inherit these overrides.
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)$/i.test(key)) delete env[key]
    }
    const { stdout } = await execFileP('git', ['-C', directory, 'rev-parse', '--is-inside-work-tree'], { windowsHide: true, timeout: 5000, env })
    isGit = stdout.trim() === 'true'
  } catch (error) {
    // An ordinary non-Git folder is supported; a missing executable is explicit.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Git is not installed on this computer')
    if ((error as { killed?: boolean }).killed) throw new Error('Git directory inspection timed out')
    if (!/not a git repository/i.test(String((error as { stderr?: string }).stderr ?? ''))) throw error
  }
  let instructions = ''
  const instructionsFile = join(directory, 'AGENTS.md')
  try {
    const physical = await realpath(instructionsFile)
    const rel = relative(directory, physical)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('AGENTS.md resolves outside the project directory')
    const info = await lstat(physical)
    if (!info.isFile() || info.size > 65536) throw new Error('Project AGENTS.md must be a readable file no larger than 64 KiB')
    instructions = await readFile(physical, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const scope = createHash('sha256').update(`${binding.id}\0${directory}`).digest('hex').slice(0, 32)
  return { binding, directory, isGit, instructions, scope }
}

const locks = new Map<string, Promise<void>>()

/** Serialize this daemon's agents against the same physical worktree. */
export async function withProjectWorkspaceLock<T>(directory: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? directory.toLowerCase() : directory
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => gate)
  locks.set(key, tail)
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('Workspace wait aborted')) }
      if (signal.aborted) { abort(); return }
      signal.addEventListener('abort', abort, { once: true })
      void previous.then(() => { signal.removeEventListener('abort', abort); resolve() })
    })
    signal.throwIfAborted()
    return await work()
  } finally {
    release()
    void tail.then(() => { if (locks.get(key) === tail) locks.delete(key) })
  }
}
