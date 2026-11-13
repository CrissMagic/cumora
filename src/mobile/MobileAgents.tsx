import { useMemo, useState } from 'react'
import { api } from '@/api/client'
import { Avatar } from '@/components/Avatar'
import { useMe } from '@/stores/auth'
import { useApp } from '@/stores/app'
import { useParticipants } from '@/stores/participants'
import { useConversations } from '@/stores/conversations'
import { IChat, IPlus } from '@/components/icons'
import { MobilePageHeader } from './MobilePageHeader'
import { useMobileBack } from './useMobileBack'
import { AgentEditor } from '@/components/AgentEditor'
import { HumanBadge } from '@/components/HumanBadge'
import { type MessageKey, useTLabel } from '@/lib/i18n'
import type { Participant } from '@/types'

// statusLabels kept as the source of truth (English fallback), so the
// author's copy edits stay in sync. The parallel statusLabelsKey gives t()
// a MessageKey to resolve without changing the data shape.
const statusLabels: Record<string, string> = {
  avail: 'Available',
  working: 'Working',
  thinking: 'Thinking',
  waiting: 'Waiting on you',
  resting: 'Resting',
}
const statusLabelsKey: Record<string, MessageKey> = {
  avail: 'magents.statusAvail',
  working: 'magents.statusWorking',
  thinking: 'magents.statusThinking',
  waiting: 'magents.statusWaiting',
  resting: 'magents.statusResting',
}

const statusColors: Record<string, string> = {
  avail: 'var(--avail)',
  working: 'var(--working)',
  thinking: 'var(--thinking)',
  waiting: 'var(--waiting)',
  resting: 'var(--resting)',
}

export function MobileAgents() {
  // Non-invasive i18n: prefer translated MessageKey, fall back to the
  // author's original English literal so future copy edits stay in sync.
  const tLabel = useTLabel()
  const byId = useParticipants((s) => s.byId)
  const convoList = useConversations((s) => s.list)
  const setView = useApp((s) => s.setView)
  const select = useApp((s) => s.selectConversation)
  const meId = useMe()
  const [editing, setEditing] = useState<Participant | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const active = useApp((s) => s.view === 'agents')
  useMobileBack(active && editorOpen, () => setEditorOpen(false))
  // Which agent's DM is being created right now, so a double-tap on a slow
  // network cannot fire two openDirect calls.
  const [opening, setOpening] = useState<string | null>(null)

  // Real roster, scoped to the active workspace via the participants store
  // (which is itself re-fetched on workspace switch). Drop departed agents
  // and the signed-in user.
  const { agents, humans } = useMemo(() => {
    const all = Object.values(byId).filter((p) => !p.departedAt)
    return {
      agents: all.filter((p): p is Participant => p.kind === 'agent'),
      humans: all.filter((p): p is Participant => p.kind === 'human' && p.id !== meId),
    }
  }, [byId, meId])

  /** Tap an agent → jump to the direct chat with me + them, creating it if
   *  this member does not have one yet.
   *
   *  The server seeds the agent's DM only for whoever hired it, so every other
   *  member has no row for any agent added after they joined. Without the
   *  fallback the card was a dead tap for them — no navigation, no error — while
   *  the same tap on desktop worked. `openDirect` is the idempotent create-or-
   *  find the desktop card and MobileParticipantInfo already use. */
  const goChat = async (agentId: string) => {
    if (!meId || opening) return
    const direct = convoList.find((c) =>
      c.kind === 'direct' && c.members.includes(meId) && c.members.includes(agentId),
    )
    if (direct) {
      setView('conversations')
      select(direct.id)
      return
    }
    setOpening(agentId)
    try {
      const { id } = await api.openDirect(agentId)
      // Refresh so the brand-new DM is in the store before we navigate into it.
      await useConversations.getState().reload()
      setView('conversations')
      select(id)
    } catch (err) {
      console.warn('[MobileAgents] openDirect failed', err)
    } finally {
      setOpening(null)
    }
  }

  return (
    <section className="flex flex-col h-full overflow-hidden bg-paper">
      <MobilePageHeader title={tLabel('nav.agents', 'Agents')}
        detail={tLabel('magents.titleCount', `${agents.length} agents`, { n: agents.length })}
        action={<button type="button" onClick={() => { setEditing(null); setEditorOpen(true) }}
          className="mobile-primary-icon-button" aria-label={tLabel('magents.hireTitle', 'Hire an agent')}>
          <IPlus className="h-5 w-5" />
        </button>} />
      <div className="flex-1 min-h-0 overflow-y-auto pb-6 px-5">
        <div className="divide-y divide-ink-100">
          {agents.length === 0 && (
            <div className="my-6 rounded-2xl border border-ink-100 bg-cloud px-6 py-12 text-center text-[14px] text-ink-500">
              {tLabel('magents.empty', 'No agents in this workspace yet. Hire one below.')}
            </div>
          )}
          {agents.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left py-5 active:bg-ink-100/50"
              onClick={() => { void goChat(p.id) }}
              disabled={opening === p.id}
            >
              <div className="flex items-center gap-3.5">
                <Avatar p={p} size={48} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-medium text-[16px] tracking-tight leading-tight" style={{ letterSpacing: '-0.01em' }}>{p.name}</h3>
                  {p.role && (
                    <div className="text-[13px] text-ink-500 leading-5 mt-1">{p.role}</div>
                  )}
                  <div className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium"
                    style={{ color: 'var(--ink-500)' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColors[p.status] }} />
                    {statusLabels[p.status] ? tLabel(statusLabelsKey[p.status], statusLabels[p.status]) : ''}
                  </div>
                </div>
                <IChat className="h-5 w-5 shrink-0 text-ink-400" />
              </div>
              {p.bio && (
                <div className="mt-3 text-[13px] text-ink-500 leading-5 line-clamp-2">{p.bio}</div>
              )}
              {(p.tools ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(p.tools ?? []).slice(0, 4).map((t) => (
                    <span key={t} className="text-[12px] py-1 px-2 rounded-md bg-ink-100 text-ink-500">{t}</span>
                  ))}
                </div>
              )}
            </button>
          ))}

          <button
            type="button"
            onClick={() => { setEditing(null); setEditorOpen(true) }}
            className="w-full rounded-xl border border-ink-100 bg-cloud p-4 flex items-center gap-3 text-ink-700 mt-5 active:bg-ink-100"
          >
            <div className="w-10 h-10 grid place-items-center rounded-lg bg-ink-100">
              <IPlus className="w-5 h-5" strokeWidth={2} />
            </div>
            <div className="text-left">
              <div className="font-display font-medium text-[15px] text-ink-900" style={{ letterSpacing: '-0.01em' }}>{tLabel('magents.hireTitle', 'Hire an agent')}</div>
              <div className="text-[13px] text-ink-500">{tLabel('magents.hireSub', 'design a new teammate')}</div>
            </div>
          </button>
        </div>

        {editorOpen && (
          <AgentEditor agent={editing} onClose={() => { setEditorOpen(false); setEditing(null) }} />
        )}

        {humans.length > 0 && (
          <>
            <div className="pt-7 pb-3 text-[14px] font-semibold text-ink-500">{tLabel('magents.humansHead', 'Human teammates')}</div>
            <div className="space-y-2">
              {humans.map((p) => (
                <div key={p.id} className="bg-cloud rounded-[12px] p-3.5 flex items-center gap-3"
                  style={{ border: '1px solid var(--ink-100)' }}>
                  <Avatar p={p} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[14px] text-ink-900 leading-tight">{p.name}</div>
                    <div className="text-[12px] text-ink-500 mt-1">{statusLabels[p.status] ? tLabel(statusLabelsKey[p.status], statusLabels[p.status]) : ''}</div>
                  </div>
                  <HumanBadge />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
