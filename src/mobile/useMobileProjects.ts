import { useCallback, useEffect, useState } from 'react'
import { api, type ApiProject } from '@/api/client'
import { useAuth } from '@/stores/auth'

/** One read-only project snapshot shared by the mobile switcher and overview. */
export function useMobileProjects() {
  const companyId = useAuth((s) => s.activeCompanyId)
  const [list, setList] = useState<ApiProject[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, select] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const reload = useCallback(() => setRefresh((v) => v + 1), [])

  useEffect(() => { setList([]); setLoaded(false); select(null) }, [companyId])
  useEffect(() => {
    let alive = true
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      try {
        const rows = await api.listProjects()
        if (alive) { setList(rows.filter((p) => p.status === 'active')); setError(null) }
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      } finally { pending = false; if (alive) setLoaded(true) }
    }
    void load()
    const timer = setInterval(() => { if (!document.hidden) void load() }, 10000)
    return () => { alive = false; clearInterval(timer) }
  }, [companyId, refresh])

  return { list, loaded, error, reload, selectedId, select }
}

export type MobileProjectNavigation = ReturnType<typeof useMobileProjects>
