import { useEffect, useRef, useState } from 'react'
import { api, ws, type ConversationAgentControlState } from '@/api/client'

/** Shared by desktop and mobile. Requesting pause is deliberately distinct
 * from the daemon confirming that its active process has finished stopping. */
export function ConversationAgentControl({ conversationId }: { conversationId: string }) {
  const [state, setState] = useState<ConversationAgentControlState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const refresh = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    let loading = false
    const load = async () => {
      if (loading || !alive) return
      loading = true
      const startedGeneration = generation.current
      clearTimeout(timer)
      let delay = 15_000
      try {
        const next = await api.conversationAgentControl(conversationId)
        if (alive && startedGeneration === generation.current) {
          setState(next)
          setError('')
          if (next.paused && next.agents.some((a) => !a.confirmed)) delay = 2000
        }
      } catch { if (alive) setError('无法读取智能体状态') }
      finally {
        loading = false
        if (alive) timer = setTimeout(() => { void load() }, delay)
      }
    }
    setState(null)
    setError('')
    void load()
    refresh.current = load
    const off = ws.on((e) => { if (e.type === 'conversation.updated' && e.conversationId === conversationId) void load() })
    return () => { alive = false; clearTimeout(timer); off() }
  }, [conversationId])

  if (!state || (!state.supported && !state.paused)) return error ? <span role="status" className="text-xs text-coral">{error}</span> : null
  const confirmed = state.agents.every((a) => a.confirmed)
  return <div className="flex shrink-0 items-center justify-end gap-3 border-b border-ink-100 bg-cloud px-4 py-1">
    {state.paused && <span role="status" className="mr-auto text-xs text-ink-500">{confirmed ? '已暂停' : '已暂停新任务 · 等待本机确认停止'}</span>}
    {error && <span role="alert" className="text-xs text-coral">{error}</span>}
    <button
      type="button"
      disabled={busy}
      className="rounded-lg px-2.5 py-2 text-xs font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-50"
      title={state.paused ? '手动恢复当前会话；暂停期间的消息将继续处理' : '暂停当前会话所有智能体，直到手动恢复'}
      onClick={async () => {
        setBusy(true)
        generation.current++
        setError('')
        try { setState(await api.setConversationAgentControl(conversationId, !state.paused)) }
        catch { setError('操作失败，请重试') }
        finally { setBusy(false); void refresh.current() }
      }}
    >{busy ? '处理中…' : state.paused ? '恢复智能体' : '暂停智能体'}</button>
  </div>
}
