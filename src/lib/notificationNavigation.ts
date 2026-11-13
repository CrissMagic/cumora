import { useAuth } from '@/stores/auth'
import { useConversations } from '@/stores/conversations'
import { useApp } from '@/stores/app'

export async function openNotificationConversation(conversationId: string, companyId?: string): Promise<void> {
  const auth = useAuth.getState()
  if (!auth.user) return
  if (companyId && auth.activeCompanyId !== companyId) {
    if (!auth.companies.some((c) => c.id === companyId)) return
    const switching = auth.setActiveCompany(companyId)
    const epoch = useAuth.getState().contextEpoch
    await switching
    if (useAuth.getState().contextEpoch !== epoch) return
    await useConversations.getState().reload()
    if (useAuth.getState().contextEpoch !== epoch) return
  }
  // Membership may have changed since the toast was created.
  if (!useConversations.getState().list.some((c) => c.id === conversationId)) return
  useApp.getState().setView('conversations')
  useApp.getState().selectConversation(conversationId)
}
