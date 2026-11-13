/** User-owned service configuration. Kept independent of Vite and auth stores
 * so syntax, session scoping and connection behavior can be tested directly. */
export const SERVER_ADDRESS_KEY = 'cumora.serverUrl'

export function normalizeServerAddress(input: string): string {
  let url: URL
  try { url = new URL(input.trim()) } catch { throw new Error('invalid-server-address') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('invalid-server-address')
  }
  return url.origin
}

export function resolveServerAddress(saved: string | null, baked?: string): string {
  // A saved choice wins, including an invalid value requiring reconfiguration.
  // Never quietly route an existing session to another build-time server.
  const value = saved ?? baked
  if (!value?.trim()) return ''
  try { return normalizeServerAddress(value) } catch { return '' }
}

export function needsServerAddress(desktop: boolean, development: boolean, origin: string): boolean {
  return desktop && !development && !origin
}

export function saveServerAddress(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  origin: string | null,
  clearSession: () => void,
): void {
  if (origin == null || !origin.trim()) storage.removeItem(SERVER_ADDRESS_KEY)
  else storage.setItem(SERVER_ADDRESS_KEY, normalizeServerAddress(origin))
  clearSession()
}

export async function checkServerAddress(origin: string, fetcher: typeof fetch = fetch): Promise<string> {
  const normalized = normalizeServerAddress(origin)
  const response = await fetcher(`${normalized}/api/health`, {
    method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok || (await response.json())?.ok !== true) throw new Error('server-unavailable')
  return normalized
}
