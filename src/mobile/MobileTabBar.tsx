import { useApp } from '@/stores/app'
import { useAuth } from '@/stores/auth'
import { useConversations, isMuted } from '@/stores/conversations'
import { IChat, IWhisper, IFolder, IAgent, IAgents, IShip } from '@/components/icons'
import { tapHaptic } from '@/lib/native'
import { useT, type MessageKey } from '@/lib/i18n'
import type { ViewKey } from '@/types'

// Message keys, not strings — see the same note in desktop/Rail.tsx.
const tabs: Array<{ key: ViewKey['view']; Icon: typeof IChat; label: MessageKey }> = [
  { key: 'conversations', Icon: IChat, label: 'nav.chats' },
  { key: 'whispers', Icon: IWhisper, label: 'nav.whispers' },
  { key: 'shipping', Icon: IShip, label: 'nav.ship' },
  { key: 'library', Icon: IFolder, label: 'mprojects.title' },
  { key: 'agents', Icon: IAgent, label: 'nav.agents' },
  { key: 'me', Icon: IAgents, label: 'nav.me' },
]

/** Stable, opaque root navigation. Selection never dims or scales the bar. */
export function MobileTabBar() {
  const t = useT()
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const select = useApp((s) => s.selectConversation)
  const totalUnread = useConversations((s) =>
    s.list.reduce((acc, c) => acc + (isMuted(c) ? 0 : (c.unread ?? 0)), 0),
  )
  // Whispers is owner-only (server gates /peek/agent-chats to the owner); hide
  // the tab for non-owners. Columns are dynamic so the bar stays balanced.
  const isOwner = useAuth((s) => s.companies.find((c) => c.id === s.activeCompanyId)?.role === 'owner')
  const visibleTabs = isOwner ? tabs : tabs.filter((t) => t.key !== 'whispers')

  return (
    <nav
      className="mobile-chrome mobile-tab-bar grid shrink-0"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)', paddingTop: 6, gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
    >
      {visibleTabs.map(({ key, Icon, label }) => {
        const active = view === key
        const badge = key === 'conversations' && totalUnread > 0 ? totalUnread : undefined
        return (
          <button
            type="button"
            key={key}
            aria-current={active ? 'page' : undefined}
            aria-label={t(label)}
            onClick={() => {
              if (active) return
              tapHaptic()
              setView(key)
              if (key === 'conversations') select(null)
            }}
            className="mobile-tab-button relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl mx-0.5"
            style={{ color: active ? 'var(--ink-900)' : 'var(--ink-500)' }}
          >
            <span className="mobile-tab-icon relative grid h-7 w-10 place-items-center rounded-lg">
              <Icon
                className="w-[22px] h-[22px]"
                strokeWidth={active ? 2 : 1.5}
              />
              {badge !== undefined && (
                <span
                  className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold grid place-items-center"
                  style={{ background: 'var(--coral)', color: 'white', border: '2px solid var(--cloud)' }}
                >{badge}</span>
              )}
            </span>
            <span className="text-[11px] font-medium leading-4">{t(label)}</span>
          </button>
        )
      })}
    </nav>
  )
}
