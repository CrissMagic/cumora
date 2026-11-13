import type { useApp } from '../stores/app'

type NavigationState = Pick<ReturnType<typeof useApp.getState>,
  'view' | 'mobileStack' | 'infoAgentId' | 'openDocumentId' | 'openBoardId' | 'openCalendarEventId'
  | 'closeAgentInfo' | 'closeDocumentPeek' | 'closeBoardPeek' | 'closeCalendarEventPeek'
  | 'pushMobileStack' | 'selectConversation'>

/** Return exactly one visible layer. Hidden tab state must not consume Back. */
export function navigateMobileBack(state: NavigationState, whisper: { open: boolean; close: () => void }): boolean {
  if (state.infoAgentId) { state.closeAgentInfo(); return true }
  if (state.openDocumentId) { state.closeDocumentPeek(); return true }
  if (state.openBoardId) { state.closeBoardPeek(); return true }
  if (state.openCalendarEventId) { state.closeCalendarEventPeek(); return true }
  if (state.view === 'conversations') {
    if (state.mobileStack === 'info') { state.pushMobileStack('chat'); return true }
    if (state.mobileStack === 'chat') { state.selectConversation(null); return true }
  }
  if (state.view === 'whispers' && whisper.open) { whisper.close(); return true }
  return false
}
