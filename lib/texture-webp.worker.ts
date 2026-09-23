/// <reference lib="webworker" />
// One texture, decoded and re-encoded as WebP, off the main thread.
//
// A MODULE WORKER rather than the inline-source kind png-sequence.ts uses,
// because this one needs the TGA decoder and duplicating a decoder into a
// string is how two decoders drift apart. The bundler follows the import.
//
// WHY IT EXISTS AT ALL: PNG and BMP decode through createImageBitmap, which is
// native and already off the main thread, so those parallelise on their own.
// TGA has no magic bytes, createImageBitmap refuses it, and decodeTga is
// synchronous JavaScript — on the main thread every lane queues behind every
// other one and the window stutters while a character uploads. Here they do not.
//
// It never throws at the caller. A texture it cannot read comes back `ok: false`
// and the upload keeps the original file.

import { decodeTga } from "./tga"
import { declaresAlpha, opaqueEverywhere } from "./texture-alpha"

export type WebpJob = { id: number; buffer: ArrayBuffer; path: string; quality: number }
export type WebpDone = { id: number; ok: true; out: ArrayBuffer } | { id: number; ok: false }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<WebpJob>) => {
  const { id, buffer, path, quality } = e.data
  try {
    let bitmap: ImageBitmap
    if (/\.tga$/i.test(path)) {
      const img = decodeTga(buffer)
      bitmap = await createImageBitmap(new ImageData(img.data, img.width, img.height))
    } else {
      bitmap = await createImageBitmap(new Blob([buffer]), { premultiplyAlpha: "none", colorSpaceConversion: "none" })
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const c2d = canvas.getContext("2d")
    if (!c2d) {
      bitmap.close()
      ctx.postMessage({ id, ok: false } satisfies WebpDone)
      return
    }
    c2d.drawImage(bitmap, 0, 0)
    bitmap.close()
    // A texture with anything behind its alpha is left as it was — see
    // texture-alpha.ts. The canvas has already eaten the colour by now; this
    // decides whether to hand back the damage or the original.
    if (declaresAlpha(buffer, path) && !opaqueEverywhere(c2d, canvas.width, canvas.height)) {
      ctx.postMessage({ id, ok: false } satisfies WebpDone)
      return
    }
    const out = await (await canvas.convertToBlob({ type: "image/webp", quality })).arrayBuffer()
    ctx.postMessage({ id, ok: true, out } satisfies WebpDone, [out])
  } catch {
    ctx.postMessage({ id, ok: false } satisfies WebpDone)
  }
}
