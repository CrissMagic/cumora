/** Sheets consume the first event; page navigation is the fallback, before exit. */
export function dispatchAndroidBack(
  target: EventTarget,
  canGoBack: boolean,
  fallback: { historyBack: () => void; exit: () => void },
): void {
  for (const name of ['cumora:hardware-back', 'cumora:navigation-back']) {
    if (!target.dispatchEvent(new Event(name, { cancelable: true }))) return
  }
  if (canGoBack) fallback.historyBack()
  else fallback.exit()
}
