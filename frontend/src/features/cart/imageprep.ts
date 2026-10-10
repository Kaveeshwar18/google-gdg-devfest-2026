// Image preparation before OCR (plan 3.3: resize, grayscale, contrast). The maths is pure so it can be tested;
// only `prepareImage` touches the browser. Nothing here uploads anything or logs anything.

export const MAX_SIDE = 1600

/** Scale (w, h) down so the longer side is at most `max`. Never scales up. */
export function fitWithin(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/**
 * In place: RGBA pixels to grayscale, then stretch the contrast so the 1st to 99th percentile of brightness
 * fills 0..255. Flat images (all one tone) are left as plain grayscale.
 */
export function grayscaleStretch(rgba: Uint8ClampedArray): void {
  const hist = new Uint32Array(256)
  const pixels = rgba.length / 4
  for (let i = 0; i < rgba.length; i += 4) {
    const g = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])
    rgba[i] = rgba[i + 1] = rgba[i + 2] = g
    hist[g] += 1
  }
  const percentile = (p: number) => {
    let seen = 0
    for (let v = 0; v < 256; v++) {
      seen += hist[v]
      if (seen >= p * pixels) return v
    }
    return 255
  }
  const lo = percentile(0.01)
  const hi = percentile(0.99)
  if (hi - lo < 8) return
  for (let i = 0; i < rgba.length; i += 4) {
    const v = Math.max(0, Math.min(255, Math.round(((rgba[i] - lo) * 255) / (hi - lo))))
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v
  }
}

/** Resized, grayscale, higher-contrast copy of `image`. Any failure returns the original file untouched. */
export async function prepareImage(image: Blob): Promise<Blob> {
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(image)
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return image
    ctx.drawImage(bitmap, 0, 0, width, height)
    const data = ctx.getImageData(0, 0, width, height)
    grayscaleStretch(data.data)
    ctx.putImageData(data, 0, 0)
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    canvas.width = canvas.height = 0 // release the pixel buffer
    return out ?? image
  } catch {
    return image
  } finally {
    bitmap?.close()
  }
}
