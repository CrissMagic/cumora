/**
 * Mobile project hub — projects, documents, boards and calendar.
 *
 * Each subview reads the same store the desktop view uses (no mock data)
 * and opens artifacts through the existing artifact-peek channel
 * (openDocumentPeek / openBoardPeek / openCalendarEventPeek). The peek
 * pane in MobileApp slides up the shared editor / kanban / event UI.
 */
import { useEffect, useState } from 'react'
import { useApp } from '@/stores/app'
import { useAuth } from '@/stores/auth'
import { useDocuments } from '@/stores/documents'
import { useBoards } from '@/stores/boards'
import { useParticipants } from '@/stores/participants'
import { IDoc, IBoard, ICalendar, IPlus, IFolder } from '@/components/icons'
import { MobilePageHeader } from './MobilePageHeader'
import { MobileProjects } from './MobileProjects'
import { useMobileBack } from './useMobileBack'
import type { MobileProjectNavigation } from './useMobileProjects'
import { MobileCalendar } from './MobileCalendar'
import { EventEditor } from '@/components/EventEditor'
import { cn } from '@/lib/utils'
import { useT, type MessageKey, useTLabel } from '@/lib/i18n'

type LibTab = 'projects' | 'documents' | 'boards' | 'calendar'

const TABS: Array<{ key: LibTab; label: string; Icon: typeof IDoc }> = [
  { key: 'projects', label: 'Projects', Icon: IFolder },
  { key: 'documents', label: 'Documents', Icon: IDoc },
  { key: 'boards', label: 'Boards', Icon: IBoard },
  { key: 'calendar', label: 'Calendar', Icon: ICalendar },
]
// i18n: parallel lookup so the TABS shape above stays upstream-mergeable.
const TAB_LABEL_KEY: Record<LibTab, MessageKey> = {
  projects: 'mprojects.title',
  documents: 'moblib.tabDocuments',
  boards: 'moblib.tabBoards',
  calendar: 'moblib.tabCalendar',
}

export function MobileLibrary({ projects }: { projects: MobileProjectNavigation }) {
  // i18n: prefer the translated key, fall back to the inline English.
  const tLabel = useTLabel()
  const [tab, setTab] = useState<LibTab>('projects')
  const create = useDocuments((s) => s.create)
  const createBoard = useBoards((s) => s.createBoard)
  const openDocumentPeek = useApp((s) => s.openDocumentPeek)
  const openBoardPeek = useApp((s) => s.openBoardPeek)
  const [creating, setCreating] = useState(false)
  const [eventEditorOpen, setEventEditorOpen] = useState(false)
  const active = useApp((s) => s.view === 'library')
  useMobileBack(active && eventEditorOpen, () => setEventEditorOpen(false))

  const onPlus = async () => {
    if (creating) return
    if (tab === 'projects') return
    if (tab === 'calendar') {
      setEventEditorOpen(true)
      return
    }
    setCreating(true)
    try {
      if (tab === 'documents') {
        const d = await create({ title: tLabel('docs.untitled', 'Untitled') })
        openDocumentPeek(d.id)
      } else if (tab === 'boards') {
        const id = await createBoard(tLabel('moblib.untitledBoard', 'Untitled board'))
        openBoardPeek(id, null)
      }
    } catch (err) {
      console.warn('[library] create failed', err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="relative flex flex-col h-full bg-paper">
      <MobilePageHeader title={tLabel('mprojects.title', 'Projects')} action={tab !== 'projects' &&
        <button type="button" onClick={onPlus} disabled={creating} className="mobile-primary-icon-button"
          aria-label={tLabel(tab === 'documents' ? 'moblib.newDocument' : tab === 'boards' ? 'moblib.newBoard' : 'moblib.newEvent', 'Create')}>
          <IPlus className="h-5 w-5" />
        </button>
      }>
        <div className="px-5 flex justify-between gap-2">
          {TABS.map(({ key, label }) => {
            const active = tab === key
            return (
              <button
                type="button"
                key={key}
                onClick={() => setTab(key)}
                aria-pressed={active}
                data-library-tab={key}
                className={cn(
                  'min-h-12 text-[14px] font-medium flex items-center justify-center gap-2 border-b-2',
                  active
                    ? 'text-ink-900 border-ink-900'
                    : 'text-ink-500 border-transparent',
                )}
              >
                {tLabel(TAB_LABEL_KEY[key], label)}
              </button>
            )
          })}
        </div>
      </MobilePageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'projects' && <MobileProjects projects={projects} />}
        {tab === 'documents' && <DocumentsList />}
        {tab === 'boards' && <BoardsList />}
        {tab === 'calendar' && <MobileCalendar />}
      </div>

      {eventEditorOpen && (
        <EventEditor event={null} onClose={() => setEventEditorOpen(false)} />
      )}
    </section>
  )
}

function timeAgo(iso: string, t: ReturnType<typeof useT>): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return t('docs.justNow')
  if (ms < 3600_000) return t('docs.minutesAgo', { n: Math.floor(ms / 60_000) })
  if (ms < 86_400_000) return t('docs.hoursAgo', { n: Math.floor(ms / 3_600_000) })
  return new Date(iso).toLocaleDateString()
}

function DocumentsList() {
  const t = useT()
  const tLabel = useTLabel()
  const list = useDocuments((s) => s.list)
  const loaded = useDocuments((s) => s.loaded)
  const load = useDocuments((s) => s.load)
  const openDocumentPeek = useApp((s) => s.openDocumentPeek)
  const byId = useParticipants((s) => s.byId)
  const me = useAuth((s) => s.user)

  useEffect(() => { void load() }, [load])

  return (
    <div className="pb-24">
      {!loaded && (
        <div className="px-6 py-10 text-center text-[13px] text-ink-500">{t('common.loading')}</div>
      )}
      {loaded && list.length === 0 && (
        <div className="mx-5 mt-6 rounded-2xl border border-ink-100 bg-cloud px-6 py-12 text-center text-[14px] text-ink-500 leading-relaxed">
          <IDoc className="mx-auto mb-4 h-8 w-8 text-ink-400" />
          {t('moblib.emptyDocuments')}
        </div>
      )}
      <div className="divide-y divide-ink-100">
        {list.map((d) => {
          const author = byId[d.createdBy]
          const authorName = author?.name ?? (d.createdBy === me?.id ? t('moblib.you') : d.createdBy)
          return (
            <button
              type="button"
              key={d.id}
              onClick={() => openDocumentPeek(d.id)}
              className="w-full text-left grid grid-cols-[40px_1fr_auto] gap-3.5 py-4 px-5 active:bg-sky2-50 transition"
            >
              <div className="w-10 h-10 rounded-[10px] grid place-items-center bg-sky2-50 text-skype-deep">
                <IDoc className="w-[18px] h-[18px]" />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-ink-900 truncate">{d.title || tLabel('docs.untitled', 'Untitled')}</div>
                <div className="mt-1 text-[12px] text-ink-500 truncate">
                  {authorName} · {timeAgo(d.updatedAt, t)}
                </div>
              </div>
              <span className="self-center text-ink-300 text-[18px]">›</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function BoardsList() {
  const t = useT()
  const tLabel = useTLabel()
  const list = useBoards((s) => s.list)
  const loadingList = useBoards((s) => s.loadingList)
  const loadList = useBoards((s) => s.loadList)
  const openBoardPeek = useApp((s) => s.openBoardPeek)
  const byId = useParticipants((s) => s.byId)
  const me = useAuth((s) => s.user)

  useEffect(() => { void loadList() }, [loadList])

  return (
    <div className="pb-24">
      {loadingList && list.length === 0 && (
        <div className="px-6 py-10 text-center text-[13px] text-ink-500">{t('common.loading')}</div>
      )}
      {!loadingList && list.length === 0 && (
        <div className="mx-5 mt-6 rounded-2xl border border-ink-100 bg-cloud px-6 py-12 text-center text-[14px] text-ink-500 leading-relaxed">
          <IBoard className="mx-auto mb-4 h-8 w-8 text-ink-400" />
          {t('moblib.emptyBoards')}
        </div>
      )}
      <div className="divide-y divide-ink-100">
        {list.map((b) => {
          const author = byId[b.createdBy]
          const authorName = author?.name ?? (b.createdBy === me?.id ? t('moblib.you') : b.createdBy)
          return (
            <button
              type="button"
              key={b.id}
              onClick={() => openBoardPeek(b.id, null)}
              className="w-full text-left grid grid-cols-[40px_1fr_auto] gap-3.5 py-4 px-5 active:bg-sky2-50 transition"
            >
              <div className="w-10 h-10 rounded-[10px] grid place-items-center text-skype-deep"
                style={{ background: 'var(--ink-100)' }}>
                <IBoard className="w-[18px] h-[18px]" />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-ink-900 truncate">{b.title || tLabel('moblib.untitledBoard', 'Untitled board')}</div>
                <div className="mt-1 text-[12px] text-ink-500 truncate">
                  {b.description ? b.description : `${authorName} · ${timeAgo(b.updatedAt, t)}`}
                </div>
              </div>
              <span className="self-center text-ink-300 text-[18px]">›</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

