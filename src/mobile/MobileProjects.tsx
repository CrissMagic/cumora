import { useApp } from '@/stores/app'
import { IFolder } from '@/components/icons'
import { useT } from '@/lib/i18n'
import type { ApiProjectWorkspace } from '@/api/client'
import type { MobileProjectNavigation } from './useMobileProjects'

function workspaceLabel(workspace: ApiProjectWorkspace, t: ReturnType<typeof useT>) {
  if (workspace.computerStatus !== 'online') return t('project.workspaceOffline')
  if (workspace.status === 'error') return t('project.workspaceError')
  if (workspace.status === 'pending') return t('project.workspacePending')
  return t(workspace.isGit ? 'project.workspaceGit' : 'project.workspaceReady')
}

/** Desktop owns project setup; mobile only selects an existing project to chat. */
export function MobileProjects({ projects }: { projects: MobileProjectNavigation }) {
  const t = useT()
  const open = (id: string) => { projects.select(id); useApp.getState().setView('conversations') }
  return <div className="px-5 pb-8" data-projects>
    {projects.error && <div role="alert" className="mt-5 rounded-xl border border-ink-100 bg-cloud p-4 text-[13px] text-coral-deep">
      {projects.error}<button type="button" onClick={projects.reload} className="ml-3 min-h-11 font-semibold">{t('mprojects.retry')}</button>
    </div>}
    {!projects.loaded && <p className="py-12 text-center text-[14px] text-ink-500">{t('common.loading')}</p>}
    {projects.loaded && !projects.error && projects.list.length === 0 && <div className="my-6 rounded-2xl border border-ink-100 bg-cloud px-6 py-12 text-center">
      <IFolder className="mx-auto mb-4 h-8 w-8 text-ink-400" />
      <p className="text-[16px] font-semibold text-ink-900">{t('mprojects.empty')}</p>
      <p className="mt-2 text-[13px] leading-5 text-ink-500">{t('mprojects.emptyBody')}</p>
    </div>}
    <div className="space-y-3 pt-5">
      {projects.list.map((project) => <button key={project.id} type="button" data-project-id={project.id}
        onClick={() => open(project.id)} className="flex w-full items-start gap-3.5 rounded-2xl border border-ink-100 bg-cloud p-4 text-left active:bg-ink-100/50">
        <IFolder className="mt-1 h-6 w-6 shrink-0 text-ink-500" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-ink-900 break-words">{project.name}</h2>
          {(project.workspaces ?? []).length === 0 && <p className="mt-2 text-[13px] text-ink-500">{t('mprojects.unbound')}</p>}
          {(project.workspaces ?? []).map((w) => <div key={w.id} className="mt-2">
            <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-500">
              <span>{w.computerName}</span><span>· {workspaceLabel(w, t)}</span>
            </div>
            <p className="mt-1 line-clamp-2 break-all text-[13px] leading-5 text-ink-500">{w.path}</p>
          </div>)}
          <p className="mt-3 text-[12px] text-ink-500">{t('mprojects.chatCount', { n: project.conversationCount })}</p>
        </div>
        <span className="mt-1 text-ink-400" aria-hidden="true">›</span>
      </button>)}
    </div>
  </div>
}
