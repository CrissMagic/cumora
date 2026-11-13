import { lazy, Suspense, type ComponentProps } from 'react'
import { useT } from '@/lib/i18n'

const Editor = lazy(() => import('./DocumentEditor').then((module) => ({ default: module.DocumentEditor })))

/** Keep the collaborative editor out of chat/login startup on both platforms. */
export function LazyDocumentEditor(props: ComponentProps<typeof Editor>) {
  const t = useT()
  return (
    <Suspense fallback={<div role="status" className="h-full grid place-items-center bg-cloud text-sm text-ink-400">{t('mapp.openingDoc')}</div>}>
      <Editor {...props} />
    </Suspense>
  )
}
