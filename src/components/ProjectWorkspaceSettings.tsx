import { useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { useT } from '@/lib/i18n'
import type { ProjectWorkspace } from '../../shared/project-workspaces'

export function ProjectWorkspaceSettings({ projectId, archived = false, active = true }: { projectId: string; archived?: boolean; active?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [workspaces, setWorkspaces] = useState<ProjectWorkspace[]>([])
  const [computers, setComputers] = useState<Array<{ id: string; name: string; status: string }>>([])
  const [computerId, setComputerId] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const generation = useRef(0)
  const pollingActive = useRef(active)
  pollingActive.current = active
  const companyId = useAuth((s) => s.activeCompanyId)
  const role = useAuth((s) => s.companies.find((company) => company.id === s.activeCompanyId)?.role)
  const editable = !archived && (role === 'owner' || role === 'admin')

  useEffect(() => {
    if (!open) return
    generation.current += 1
    setWorkspaces([]); setComputers([]); setComputerId(''); setPath('')
    setBusy(false); setError(null); setLoadError(null)
    let alive = true
    const load = async () => {
      if (!pollingActive.current) return
      const started = generation.current
      try {
        const data = await api.projectWorkspaces(projectId)
        if (alive && started === generation.current) { setWorkspaces(data.workspaces); setComputers(data.computers); setLoadError(null) }
      } catch (reason) { if (alive && started === generation.current) setLoadError(reason instanceof Error ? reason.message : String(reason)) }
    }
    void load()
    const timer = setInterval(() => { void load() }, 5000)
    return () => { alive = false; generation.current += 1; clearInterval(timer) }
  }, [open, projectId, companyId])

  const save = async () => {
    const started = ++generation.current
    setBusy(true); setError(null)
    try {
      const binding = await api.bindProjectWorkspace(projectId, computerId, path)
      if (started !== generation.current) return
      setWorkspaces((rows) => [...rows.filter((row) => row.computerId !== computerId), binding])
      setPath(''); setComputerId('')
    } catch (reason) { if (started === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (started === generation.current) { generation.current += 1; setBusy(false) } }
  }

  const unbind = async (id: string) => {
    const started = ++generation.current
    setBusy(true); setError(null)
    try {
      await api.unbindProjectWorkspace(projectId, id)
      if (started !== generation.current) return
      setWorkspaces((rows) => rows.filter((row) => row.computerId !== id))
      if (computerId === id) { setComputerId(''); setPath('') }
    } catch (reason) { if (started === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (started === generation.current) { generation.current += 1; setBusy(false) } }
  }

  return <div className="mt-3 text-[12px] not-italic">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
      className="text-skype-deep font-semibold py-1">{t('project.workspace')}</button>
    {open && <div className="mt-2 space-y-3">
      {workspaces.map((binding) => {
        const computer = computers.find((row) => row.id === binding.computerId)
        const status = computer?.status === 'offline' ? t('project.workspaceOffline')
          : binding.status === 'pending' ? t('project.workspacePending')
            : binding.status === 'error' ? t('project.workspaceError')
              : binding.isGit ? t('project.workspaceGit') : t('project.workspaceReady')
        return <div key={binding.id} className="rounded-lg border border-ink-100 p-3 bg-paper">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-ink-800">{computer?.name ?? binding.computerId}</span>
            <span className={binding.status === 'error' ? 'text-coral-deep' : 'text-ink-500'}>{status}</span>
            {editable && <button type="button" disabled={busy} onClick={() => { setComputerId(binding.computerId); setPath(binding.path) }}
              className="text-skype-deep ml-auto">{t('project.workspaceChange')}</button>}
            {editable && <button type="button" disabled={busy} onClick={() => { void unbind(binding.computerId) }}
              className="text-ink-500">{t('project.workspaceUnbind')}</button>}
          </div>
          <div className="mt-1 font-mono text-[11px] break-all text-ink-700">{binding.path}</div>
          {binding.error && <div role="status" className="mt-1 break-words text-coral-deep">{binding.error}</div>}
        </div>
      })}
      {computers.length === 0 && <div className="text-ink-500">{t('project.workspaceNoComputers')}</div>}
      {editable && computers.length > 0 && <div className="flex flex-col gap-2">
        <select value={computerId} disabled={busy} aria-label={t('project.workspaceComputer')}
          onChange={(event) => {
            const id = event.target.value
            setComputerId(id); setPath(workspaces.find((row) => row.computerId === id)?.path ?? '')
          }} className="w-full rounded-lg border border-ink-100 bg-paper px-3 py-2 outline-none">
          <option value="">{t('project.workspaceComputer')}</option>
          {computers.map((computer) => <option key={computer.id} value={computer.id}>{computer.name}</option>)}
        </select>
        <input value={path} disabled={busy} onChange={(event) => setPath(event.target.value)}
          aria-label={t('project.workspacePath')} placeholder={t('project.workspacePath')}
          className="w-full rounded-lg border border-ink-100 bg-paper px-3 py-2 font-mono text-[12px] outline-none" />
        <button type="button" onClick={() => { void save() }} disabled={busy || !computerId || !path.trim()}
          className="self-start rounded-lg bg-skype text-white px-4 py-2 font-semibold disabled:opacity-50">{t('project.workspaceBind')}</button>
      </div>}
      {(error || loadError) && <div role="alert" className="text-coral-deep break-words">{error || loadError}</div>}
    </div>}
  </div>
}
