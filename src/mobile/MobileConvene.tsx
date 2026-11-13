import { useApp } from '@/stores/app'
import { useT } from '@/lib/i18n'
import { MobilePageHeader } from './MobilePageHeader'
import { useMobileBack } from './useMobileBack'

export function MobileConvene() {
  const active = useApp((state) => state.view === 'convene')
  const setView = useApp((state) => state.setView)
  const back = () => setView('conversations')
  useMobileBack(active, back)
  const t = useT()
  return (
    <section className="h-full flex flex-col bg-paper">
      <MobilePageHeader title={t('mobchat.convene')} action={
        <button type="button" onClick={back} className="mobile-icon-button text-sm text-ink-600">{t('common.close')}</button>
      } />
      <MobileConveneEmpty />
    </section>
  )
}

export function MobileConveneEmpty() {
  const t = useT()
  return (
    <div role="status" className="flex-1 flex flex-col items-center justify-center px-8 text-center">
      <h1 className="font-display font-medium text-[28px] text-ink-900 mb-2">{t('chat.comingSoon')}</h1>
      <p className="text-[14px] text-ink-500 max-w-xs leading-relaxed">{t('chat.conveneSoon')}</p>
    </div>
  )
}
