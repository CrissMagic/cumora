/** Read-only UI regression against an authenticated debug APK WebView.
 * Forward its devtools socket with adb first (see docs/MOBILE_ANDROID.md).
 * Node 22+ supplies fetch/WebSocket; no browser dependency or credentials needed.
 */
import assert from 'node:assert/strict'

const port = Number(process.argv[2] ?? 9223)
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Expected a local CDP port')
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((entry) => entry.type === 'page' && entry.url.startsWith('https://localhost'))
assert.ok(page, 'Open and sign in to the Android debug app first')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let next = 0
const pending = new Map()
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  const handler = pending.get(message.id)
  if (!handler) return
  pending.delete(message.id)
  clearTimeout(handler.timeout)
  if (message.error) handler.reject(new Error(message.error.message))
  else handler.resolve(message.result)
})
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, 15000)
  pending.set(id, { resolve, reject, timeout })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

try {
  const frames = await evaluate(`(async () => {
    const buttons = [...document.querySelectorAll('.mobile-tab-bar button')];
    if (buttons.length < 5) throw new Error('Root navigation is not visible');
    const nextFrame = () => new Promise(requestAnimationFrame);
    const samples = [];
    for (let round = 0; round < 4; round++) {
      for (const button of buttons) {
        button.click();
        for (let frame = 0; frame < 8; frame++) {
          await nextFrame();
          const panels = [...document.querySelectorAll('[data-mobile-tab]')].filter(el => el.getBoundingClientRect().width > 0);
          samples.push({ count: panels.length, opacity: Math.max(0, ...panels.map(el => Number(getComputedStyle(el).opacity))) });
        }
      }
    }
    // Consecutive taps while React is still scheduling the next render.
    for (let index = 0; index < 36; index++) { buttons[index % buttons.length].click(); await nextFrame(); }
    return { frames: samples.length, dimmed: samples.filter(s => s.opacity < .95).length,
      emptyOrOverlapping: samples.filter(s => s.count !== 1).length };
  })()`)
  assert.equal(frames.dimmed, 0, 'Root-tab switching must not fade the entire page')
  assert.equal(frames.emptyOrOverlapping, 0, 'Every frame must show exactly one root screen')

  const state = await evaluate(`(async () => {
    const wait = () => new Promise(requestAnimationFrame);
    const tabs = [...document.querySelectorAll('.mobile-tab-bar button')];
    const clickTab = async index => { tabs[index].click(); await wait(); await wait(); };
    await clickTab(0);
    const chats = document.querySelector('[data-mobile-tab=conversations]');
    const filters = [...chats.querySelectorAll('button[aria-pressed]')];
    filters[1].click(); await wait();
    const search = chats.querySelector('button[data-chat-search]');
    if (search.getAttribute('aria-expanded') !== 'true') { search.click(); await wait(); }
    const input = chats.querySelector('input[type=search]');
    const previousQuery = input.value;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Codex');
    input.dispatchEvent(new Event('input', { bubbles: true })); await wait();
    const libIndex = tabs.length - 3;
    await clickTab(libIndex);
    const library = document.querySelector('[data-mobile-tab=library]');
    library.querySelector('[data-library-tab=boards]').click(); await wait();
    await clickTab(tabs.length - 1);
    const me = document.querySelector('[data-mobile-tab=me]');
    const scroller = me.querySelector('section > .overflow-y-auto');
    scroller.scrollTop = 280; await wait();
    const previousScroll = scroller.scrollTop;
    await clickTab(0);
    const keptSearch = chats.querySelector('input') === input && input.value === 'Codex';
    const keptFilter = filters[1].getAttribute('aria-pressed') === 'true';
    await clickTab(libIndex);
    const keptLibrary = document.querySelector('[data-mobile-tab=library]') === library && library.querySelector('[data-library-tab=boards]').getAttribute('aria-pressed') === 'true';
    await clickTab(tabs.length - 1);
    const keptScroll = previousScroll > 0 && Math.abs(scroller.scrollTop - previousScroll) < 2;
    const hiddenFocusTargets = [...document.querySelectorAll('[data-mobile-tab][hidden] button')].filter(el => el.getClientRects().length > 0).length;
    // Restore the local UI without any API writes.
    await clickTab(libIndex); library.querySelector('[data-library-tab=projects]').click();
    await clickTab(0); filters[0].click();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, previousQuery);
    input.dispatchEvent(new Event('input', { bubbles: true })); search.click(); input.blur();
    return { keptSearch, keptFilter, keptLibrary, keptScroll, hiddenFocusTargets };
  })()`)
  for (const key of ['keptSearch', 'keptFilter', 'keptLibrary', 'keptScroll']) assert.equal(state[key], true, key)
  assert.equal(state.hiddenFocusTargets, 0, 'Inactive roots must be removed from interaction')
  console.log(JSON.stringify({ ...frames, ...state }))
} finally {
  socket.close()
}
