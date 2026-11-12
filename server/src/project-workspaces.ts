import { randomUUID } from 'node:crypto'
import { pool } from './db/pool.js'
import type { PoolClient } from 'pg'
import { projectWorkspacePath, ProjectWorkspaceInputError, type ProjectWorkspace, type ProjectWorkspaceContext } from '../../shared/project-workspaces.js'

const COLUMNS = `w.id, w.project_id AS "projectId", w.computer_id AS "computerId", w.path,
  w.status, w.error, w.is_git AS "isGit", w.checked_at AS "checkedAt"`

export async function listProjectWorkspaces(projectId: string, companyId: string, userId: string) {
  const { rows } = await pool.query<ProjectWorkspace>(
    `SELECT ${COLUMNS} FROM project_workspaces w
       JOIN projects p ON p.id = w.project_id JOIN computers c ON c.id = w.computer_id
      WHERE p.id = $1 AND p.company_id = $2 AND c.company_id = $2 AND c.owner_user_id = $3 AND c.revoked_at IS NULL`,
    [projectId, companyId, userId],
  )
  const { rows: computers } = await pool.query<{ id: string; name: string; status: string }>(
    `SELECT id, name, status FROM computers WHERE company_id = $1 AND owner_user_id = $2
       AND kind IN ('local', 'vps') AND revoked_at IS NULL ORDER BY name`, [companyId, userId],
  )
  return { workspaces: rows, computers }
}

export async function bindProjectWorkspace(input: {
  projectId: string; computerId: string; companyId: string; userId: string; path: unknown
}, client: Pick<PoolClient, 'query'> = pool): Promise<ProjectWorkspace | null> {
  const path = projectWorkspacePath(input.path)
  const { rows } = await client.query<ProjectWorkspace>(
    `INSERT INTO project_workspaces AS w (id, project_id, computer_id, path)
     SELECT $1, p.id, c.id, $5 FROM projects p JOIN computers c ON c.company_id = p.company_id
      WHERE p.id = $2 AND p.company_id = $3 AND c.id = $4 AND c.owner_user_id = $6
        AND c.kind IN ('local', 'vps') AND c.revoked_at IS NULL AND p.status = 'active'
     ON CONFLICT (project_id, computer_id) DO UPDATE SET
       id = EXCLUDED.id, path = EXCLUDED.path, status = 'pending', error = NULL, is_git = NULL, checked_at = NULL
     RETURNING ${COLUMNS}`,
    [randomUUID(), input.projectId, input.companyId, input.computerId, path, input.userId],
  )
  return rows[0] ?? null
}

export async function unbindProjectWorkspace(input: { projectId: string; computerId: string; companyId: string; userId: string }) {
  const { rowCount } = await pool.query(
    `DELETE FROM project_workspaces w USING projects p, computers c
      WHERE w.project_id = p.id AND w.computer_id = c.id AND p.id = $1 AND c.id = $2
        AND p.company_id = $3 AND c.company_id = $3 AND c.owner_user_id = $4`,
    [input.projectId, input.computerId, input.companyId, input.userId],
  )
  return (rowCount ?? 0) > 0
}

export async function computerProjectWorkspaces(computerId: string): Promise<ProjectWorkspace[]> {
  const { rows } = await pool.query<ProjectWorkspace>(
    `SELECT ${COLUMNS} FROM project_workspaces w JOIN computers c ON c.id = w.computer_id
       JOIN projects p ON p.id = w.project_id AND p.company_id = c.company_id
      WHERE c.id = $1 AND c.revoked_at IS NULL`, [computerId],
  )
  return rows
}

export async function reportProjectWorkspace(computerId: string, id: string, input: unknown): Promise<void> {
  if (!input || typeof input !== 'object') throw new ProjectWorkspaceInputError('Invalid workspace report')
  const value = input as Record<string, unknown>
  if (value.status !== 'ready' && value.status !== 'error') throw new ProjectWorkspaceInputError('Invalid workspace status')
  if (value.status === 'ready' && typeof value.isGit !== 'boolean') throw new ProjectWorkspaceInputError('Git detection result required')
  if (value.status === 'error' && (typeof value.error !== 'string' || !value.error.trim())) throw new ProjectWorkspaceInputError('Workspace error required')
  // The opaque id changes on rebinding; a late report cannot validate a new path.
  await pool.query(
    `UPDATE project_workspaces SET status = $3, error = $4, is_git = $5, checked_at = NOW()
      WHERE id = $1 AND computer_id = $2`,
    [id, computerId, value.status, value.status === 'error' ? String(value.error).slice(0, 1000) : null,
      value.status === 'ready' ? value.isGit : null],
  )
}

export async function agentProjectWorkspaces(agentId: string, companyId: string, computerId: string | null): Promise<ProjectWorkspaceContext[]> {
  const { rows } = await pool.query<{ projectId: string; workspace: ProjectWorkspace | null }>(
    `SELECT DISTINCT p.id AS "projectId",
       CASE WHEN w.id IS NULL THEN NULL ELSE jsonb_build_object(
         'id', w.id, 'projectId', p.id, 'computerId', w.computer_id, 'path', w.path,
         'status', w.status, 'error', w.error, 'isGit', w.is_git, 'checkedAt', w.checked_at) END AS workspace
      FROM projects p JOIN conversations cv ON cv.project_id = p.id AND cv.company_id = p.company_id
      JOIN conversation_members cm ON cm.conversation_id = cv.id AND cm.company_id = cv.company_id AND cm.participant_id = $1
      LEFT JOIN project_workspaces w ON w.project_id = p.id AND w.computer_id = $3
      WHERE p.company_id = $2
        AND EXISTS (SELECT 1 FROM project_workspaces bound WHERE bound.project_id = p.id)`,
    [agentId, companyId, computerId],
  )
  return rows
}
