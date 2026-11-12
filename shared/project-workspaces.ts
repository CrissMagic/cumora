export interface ProjectWorkspace {
  id: string
  projectId: string
  computerId: string
  path: string
  status: 'pending' | 'ready' | 'error'
  error: string | null
  isGit: boolean | null
  checkedAt: string | null
}

export interface ProjectWorkspaceContext {
  projectId: string
  workspace: ProjectWorkspace | null
}

export class ProjectWorkspaceInputError extends Error {}

/** Paths belong to the paired computer, not the API server's operating system. */
export function projectWorkspacePath(value: unknown): string {
  if (typeof value !== 'string') throw new ProjectWorkspaceInputError('An absolute directory path is required')
  const path = value.trim()
  if (!path || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) throw new ProjectWorkspaceInputError('Invalid directory path')
  if (!path.startsWith('/') && !/^[a-z]:[\\/]/i.test(path) && !/^\\\\[^\\]+\\[^\\]+/.test(path)) {
    throw new ProjectWorkspaceInputError('An absolute directory path is required')
  }
  if (path.split(/[\\/]/).some((part) => part === '..' || part.toLowerCase() === '.git')) {
    throw new ProjectWorkspaceInputError('The directory cannot traverse parents or select Git metadata')
  }
  if (/^(?:\/+|[a-z]:[\\/]+)$/i.test(path)) throw new ProjectWorkspaceInputError('Select a project directory, not a filesystem root')
  return path
}

/** Filter before triage, freshness marking and ACK: other projects stay unread. */
export function selectProjectInbox<T extends { project_id?: string | null; conversation_id?: string }>(
  rows: readonly T[], contexts: readonly ProjectWorkspaceContext[], conversationId?: string | null,
  attempted: ReadonlySet<string | null> = new Set(),
): { rows: T[]; projectId: string | null; scoped: boolean; remaining: boolean; exhausted: boolean } {
  if (!contexts.length) return { rows: [...rows], projectId: null, scoped: false, remaining: false, exhausted: false }
  const pending = rows.filter((row) => !attempted.has(row.project_id ?? null))
  const first = pending.find((row) => row.conversation_id === conversationId) ?? pending[0]
  const projectId = first?.project_id ?? null
  const selected = pending.filter((row) => (row.project_id ?? null) === projectId)
  return { rows: selected, projectId, scoped: true, remaining: selected.length < pending.length, exhausted: rows.length > 0 && pending.length === 0 }
}
