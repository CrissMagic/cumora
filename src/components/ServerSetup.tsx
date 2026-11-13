import { useState, type ReactNode } from 'react'
import { requiresServerAddress, setServerOrigin } from '@/api/client'
import { checkServerAddress, normalizeServerAddress } from '@/lib/server-address'
import { useT } from '@/lib/i18n'
import { CloudLogo } from './Avatar'
import { WindowDragStrip } from './WindowDragStrip'

export function ServerAddressForm({ initialValue = '', onSave }: { initialValue?: string; onSave: (origin: string) => void }) {
  const t = useT()
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => {
      event.preventDefault()
      if (busy) return
      let origin: string
      try { origin = normalizeServerAddress(value) } catch { setError(t('auth.serverInvalid')); return }
      setBusy(true)
      setError(null)
      void checkServerAddress(origin).then(onSave).catch(() => setError(t('auth.serverUnavailable'))).finally(() => setBusy(false))
    }}>
      <label className="text-[12px] font-semibold text-ink-700" htmlFor="server-address">{t('auth.apiServer')}</label>
      <input id="server-address" type="url" value={value} onChange={(event) => setValue(event.target.value)}
        autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="url"
        placeholder="https://your-server" required disabled={busy}
        className="h-11 rounded-xl border border-ink-100 bg-paper px-3 text-[14px] text-ink-900 outline-none focus:border-sky2-300 disabled:opacity-60" />
      <p className="text-[12px] leading-relaxed text-ink-500">{t('auth.serverAddressHint')}</p>
      {error && <div role="alert" className="rounded-lg bg-coral-soft px-3 py-2 text-[12px] text-coral-deep">{error}</div>}
      <button type="submit" disabled={busy || !value.trim()}
        className="h-11 rounded-xl bg-skype text-[14px] font-semibold text-white hover:bg-skype-deep disabled:opacity-50">
        {t(busy ? 'auth.serverChecking' : 'auth.serverConnect')}
      </button>
    </form>
  )
}

export function ServerSetupScreen() {
  const t = useT()
  return (
    <div className="fixed inset-0 grid place-items-center overflow-y-auto bg-paper px-6 py-14">
      <WindowDragStrip />
      <div className="w-full max-w-[420px] rounded-2xl border border-ink-100 bg-cloud p-7 shadow-soft">
        <div className="mb-5 flex items-center gap-3"><CloudLogo size={48} /><h1 className="font-display text-[23px] font-semibold text-ink-900">{t('auth.serverSetupTitle')}</h1></div>
        <p className="mb-6 text-[14px] leading-relaxed text-ink-500">{t('auth.serverSetupIntro')}</p>
        <ServerAddressForm onSave={(origin) => { setServerOrigin(origin); location.reload() }} />
      </div>
    </div>
  )
}

/** Sits outside App/AuthGate so no authenticated stores mount before setup. */
export function ServerGate({ children }: { children: ReactNode }) {
  if (requiresServerAddress()) return <ServerSetupScreen />
  return <>{children}</>
}
