// On-device OCR with Tesseract.js. Language data is lazy-loaded per script and cached by the browser.
import { createWorker, type Worker } from 'tesseract.js'
import { langInfo, type Lang } from '../../lib/langs'
import { prepareImage } from './imageprep'

const workers = new Map<string, Promise<Worker>>()
let onProgress: ((fraction: number) => void) | undefined

function workerFor(lang: Lang): Promise<Worker> {
  // English is always loaded: IDs mix English with the regional script.
  const langs = lang === 'en' ? ['eng'] : ['eng', langInfo(lang).tesseract]
  const key = langs.join('+')
  let worker = workers.get(key)
  if (!worker) {
    worker = createWorker(langs, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress?.(m.progress)
      },
    })
    workers.set(key, worker)
    // A failed start (offline, language data missing) must not be cached, or every retry would fail too.
    worker.catch(() => workers.delete(key))
  }
  return worker
}

/** Reads text from a photo on this device. Throws on failure; the caller offers manual entry. */
export async function recognize(image: Blob, lang: Lang, progress?: (fraction: number) => void): Promise<string> {
  onProgress = progress
  try {
    const worker = await workerFor(lang)
    const { data } = await worker.recognize(await prepareImage(image))
    return data.text
  } finally {
    onProgress = undefined
  }
}
