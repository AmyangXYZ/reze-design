/// <reference lib="webworker" />
// The cover ink's pixels, read off the main thread (hooks/use-cover-ink.ts).
//
// Reading a picture that came from the GPU waits for the GPU to finish what it
// was given, and a heavy scene gives it a lot: on the main thread that wait
// froze the page twice a second. Here it only holds this worker.

const ctx = self as unknown as DedicatedWorkerGlobalScope
const canvas = new OffscreenCanvas(1, 1)
const g = canvas.getContext("2d", { willReadFrequently: true })!

ctx.onmessage = (e: MessageEvent<ImageBitmap>) => {
  const shot = e.data
  if (canvas.width !== shot.width || canvas.height !== shot.height) {
    canvas.width = shot.width
    canvas.height = shot.height
  }
  g.drawImage(shot, 0, 0)
  shot.close()
  const d = g.getImageData(0, 0, canvas.width, canvas.height).data
  ctx.postMessage(d, [d.buffer])
}
