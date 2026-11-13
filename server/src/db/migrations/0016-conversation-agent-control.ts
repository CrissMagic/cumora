import { createHash } from 'node:crypto'

export const CONVERSATION_AGENT_CONTROL_SQL = `
ALTER TABLE conversations ADD COLUMN agents_paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN agent_control_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE conversation_agent_control_acks (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, agent_id),
  FOREIGN KEY (agent_id, company_id) REFERENCES participants(id, company_id) ON DELETE CASCADE
);
`

export function conversationAgentControlChecksum(): string {
  return createHash('sha256').update(CONVERSATION_AGENT_CONTROL_SQL).digest('hex')
}
