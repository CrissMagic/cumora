import { AsyncLocalStorage } from 'node:async_hooks'
import type { PoolClient } from 'pg'
import { pool } from '../db/pool.js'

/** Daemon-owned turn generations fence replies after a pause/resume cycle. */
export const conversationReplyRevisions = new AsyncLocalStorage<Readonly<Record<string, number>>>()

export async function conversationAgentsPaused(conversationId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT agents_paused FROM conversations WHERE id = $1', [conversationId])
  return rows[0]?.agents_paused === true
}

export async function loadConversationControls(agentId: string, companyId: string, client: Pick<PoolClient, 'query'> = pool) {
  const { rows } = await client.query<{ conversationId: string; paused: boolean; revision: number }>(
    `SELECT c.id AS "conversationId", c.agents_paused AS paused, c.agent_control_revision AS revision
       FROM conversations c JOIN conversation_members cm
         ON cm.conversation_id = c.id AND cm.company_id = c.company_id
      WHERE cm.participant_id = $1 AND c.company_id = $2 AND c.agent_control_revision > 0`,
    [agentId, companyId],
  )
  return rows
}

export async function conversationControlStatus(conversationId: string, companyId: string, client: Pick<PoolClient, 'query'> = pool) {
  const state = await client.query<{ paused: boolean; revision: number }>(
    `SELECT agents_paused AS paused, agent_control_revision AS revision FROM conversations WHERE id = $1 AND company_id = $2`,
    [conversationId, companyId],
  )
  if (!state.rows[0]) throw new Error('conversation not found')
  const { rows: agents } = await client.query<{ id: string; name: string; computerId: string | null; supported: boolean; confirmed: boolean }>(
    `SELECT p.id, p.name, p.computer_id AS "computerId",
            COALESCE(pc.kind <> 'cloud' AND pc.revoked_at IS NULL, FALSE) AS supported,
            COALESCE(ack.revision = cv.agent_control_revision AND ack.assignment_id = p.runtime_assignment_id, FALSE) AS confirmed
       FROM conversations cv JOIN conversation_members cm ON cm.conversation_id = cv.id AND cm.company_id = cv.company_id
       JOIN participants p ON p.id = cm.participant_id AND p.company_id = cm.company_id
       LEFT JOIN computers pc ON pc.id = p.computer_id AND pc.company_id = p.company_id
       LEFT JOIN conversation_agent_control_acks ack ON ack.conversation_id = cv.id AND ack.agent_id = p.id
      WHERE cv.id = $1 AND cv.company_id = $2 AND p.kind = 'agent' AND p.departed_at IS NULL ORDER BY p.id`,
    [conversationId, companyId],
  )
  return { ...state.rows[0], agents, supported: agents.length > 0 && agents.every((a) => a.supported) }
}
