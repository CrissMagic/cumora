import { createHash } from 'node:crypto'

export const PROJECT_WORKSPACES_SQL = `
CREATE TABLE project_workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  computer_id TEXT NOT NULL REFERENCES computers(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'error')),
  error TEXT,
  is_git BOOLEAN,
  checked_at TIMESTAMPTZ,
  UNIQUE (project_id, computer_id)
);
CREATE INDEX idx_project_workspaces_computer ON project_workspaces(computer_id);
`

export function projectWorkspacesChecksum(): string {
  return createHash('sha256').update(PROJECT_WORKSPACES_SQL).digest('hex')
}
