import { useEffect, useRef } from 'react'
import { useApp } from '@/stores/app'

/** Consume native Back for a visible local dialog or nested tab screen. */
export function useMobileBack(enabled: boolean, onBack: () => void): void {
  const handler = useRef(onBack)
  handler.current = onBack
  useEffect(() => {
    if (!enabled) return
    const back = (event: Event) => {
      if (event.defaultPrevented) return
      const state = useApp.getState()
      if (state.infoAgentId || state.openDocumentId || state.openBoardId || state.openCalendarEventId) return
      event.preventDefault()
      handler.current()
    }
    window.addEventListener('cumora:hardware-back', back)
    return () => window.removeEventListener('cumora:hardware-back', back)
  }, [enabled])
}
