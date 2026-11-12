import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IChat, IFolder } from '@/components/icons'
import { useT } from '@/lib/i18n'
import type { MobileProjectNavigation } from './useMobileProjects'

export function MobileProjectPicker({ projects, active, choosingForChat, onSelect, onClose }: {
  projects: MobileProjectNavigation; active: boolean; choosingForChat: boolean
  onSelect: (id: string | null) => void; onClose: () => void
}) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const previous = document.activeElement
    panel.current?.focus()
    const back = (event: Event) => { if (!event.defaultPrevented) { event.preventDefault(); onClose() } }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { back(event); return }
      if (event.key !== 'Tab') return
      const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      if (!buttons.length) { event.preventDefault(); return }
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('cumora:hardware-back', back)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('cumora:hardware-back', back)
      window.removeEventListener('keydown', key)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [active, onClose])

  if (!active) return null
  return createPortal(<div className="fixed inset-0 z-50 flex items-end bg-black/30" onClick={onClose}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="mobile-project-picker-title" tabIndex={-1}
      className="flex max-h-[80dvh] w-full flex-col rounded-t-[24px] bg-cloud outline-none"
      onClick={(event) => event.stopPropagation()} style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
      <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 px-5 pt-3">
        <h2 id="mobile-project-picker-title" className="text-[20px] font-semibold text-ink-900">{t(choosingForChat ? 'mprojects.chooseForChat' : 'mprojects.switch')}</h2>
        <button type="button" onClick={onClose} className="min-h-11 px-2 text-[14px] font-medium text-ink-500">{t('mprojects.cancel')}</button>
      </div>
      <div className="min-h-0 overflow-y-auto px-3 pb-3">
        {!choosingForChat && <button type="button" onClick={() => onSelect(null)} aria-pressed={projects.selectedId === null}
          className="flex min-h-16 w-full items-center gap-3 rounded-xl px-3 text-left text-ink-900">
          <IChat className="h-5 w-5 shrink-0 text-ink-500" /><span className="flex-1 text-[15px] font-medium">{t('mprojects.allChats')}</span>
          {projects.selectedId === null && <SelectedMark />}
        </button>}
        {projects.error && <div role="alert" className="p-3 text-[13px] text-coral-deep">{projects.error}<button type="button" onClick={projects.reload} className="ml-2 min-h-11 font-semibold">{t('mprojects.retry')}</button></div>}
        {!projects.loaded && <p className="p-5 text-[14px] text-ink-500">{t('common.loading')}</p>}
        {projects.loaded && !projects.error && projects.list.length === 0 && <p className="p-5 text-[14px] leading-6 text-ink-500">{t('mprojects.emptyBody')}</p>}
        {projects.list.map((project) => <button key={project.id} type="button" data-project-choice={project.id}
          disabled={choosingForChat && !(project.workspaces ?? []).some((w) => w.status === 'ready' && w.computerStatus === 'online')}
          onClick={() => onSelect(project.id)} aria-pressed={projects.selectedId === project.id}
          className="flex min-h-20 w-full items-start gap-3 rounded-xl px-3 py-4 text-left aria-pressed:bg-ink-100/60 disabled:opacity-50">
          <IFolder className="mt-0.5 h-5 w-5 shrink-0 text-ink-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-ink-900 break-words">{project.name}</div>
            <div className="mt-1 text-[12px] text-ink-500">{t('mprojects.chatCount', { n: project.conversationCount })}</div>
            {(project.workspaces ?? []).map((w) => <div key={w.id} className="mt-2 text-[13px] leading-5 text-ink-500">
              <div className="truncate">{w.computerName} · {t(w.computerStatus !== 'online' ? 'project.workspaceOffline' : w.status === 'error' ? 'project.workspaceError' : w.status === 'pending' ? 'project.workspacePending' : 'mprojects.online')}</div>
              <div className="truncate">{w.path}</div>
            </div>)}
          </div>
          {projects.selectedId === project.id && <SelectedMark />}
        </button>)}
      </div>
    </div>
  </div>, document.body)
}

function SelectedMark() {
  return <svg aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ink-900" viewBox="0 0 20 20" fill="none">
    <path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
