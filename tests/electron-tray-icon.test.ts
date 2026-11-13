import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const { createColorTrayIcon } = createRequire(import.meta.url)('../electron/tray-icon.cjs')

test('Windows tray uses the colored brand image, preserving unread badge contrast', () => {
  const brandPixels = Buffer.alloc(32 * 32 * 4)
  for (let offset = 0; offset < brandPixels.length; offset += 4) {
    brandPixels.set([240, 180, 80, 255], offset)
  }
  const resized = { toBitmap: () => Buffer.from(brandPixels) }
  const nativeImage = {
    createFromPath: () => ({ isEmpty: () => false, resize: () => resized }),
    createFromBitmap: (pixels: Buffer) => ({ pixels }),
  }
  assert.equal(createColorTrayIcon(nativeImage, '/app'), resized)
  const unread = createColorTrayIcon(nativeImage, '/app', true)
  assert.deepEqual([...unread.pixels.subarray(0, 4)], [240, 180, 80, 255])
  const badge = (7 * 32 + 25) * 4
  assert.deepEqual([...unread.pixels.subarray(badge, badge + 4)], [75, 75, 245, 255])
  assert.deepEqual(brandPixels.subarray(badge, badge + 4), Buffer.from([240, 180, 80, 255]))
})

test('missing brand artwork is explicitly refused so the caller can use its fallback', () => {
  assert.equal(createColorTrayIcon({ createFromPath: () => ({ isEmpty: () => true }) }, '/missing'), null)
})
