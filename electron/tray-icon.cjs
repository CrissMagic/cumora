const path = require('node:path')

/** Windows/Linux need a colored icon on both light and dark taskbars.
 * macOS keeps its native monochrome template and system tinting. */
function createColorTrayIcon(nativeImage, appPath, unread = false) {
  const brand = nativeImage.createFromPath(path.join(appPath, 'build', 'icon.png'))
  if (brand.isEmpty()) return null
  const size = 32
  const image = brand.resize({ width: size, height: size, quality: 'best' })
  if (!unread) return image
  const pixels = image.toBitmap()
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - 25, y - 7)
      if (distance > 6) continue
      const offset = (y * size + x) * 4
      const color = distance > 4.5 ? [255, 255, 255] : [75, 75, 245] // BGRA
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size })
}

module.exports = { createColorTrayIcon }
