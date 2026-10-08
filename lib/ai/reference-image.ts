// A reference image the user hands the AI: "make it look like this".
//
// Prepared in the tab before it is sent: shrunk to a size a model reads well
// and an upload carries cheaply, and MEASURED with the same frame metrics a
// capture gets (lib/ai/image-metrics). The model sees the picture, and it also
// gets the reference's numbers — palette, shadow and highlight tint, the
// spread of its tones — so it can steer the scene toward them and check each
// capture against the same scale, instead of judging two pictures by eye.

import { measureFrame, type FrameMetrics } from "@/lib/ai/image-metrics"

export type ReferenceImage = { dataUrl: string; metrics: FrameMetrics; width: number; height: number }

/** Long side, pixels: enough to read style and palette, small to send. */
const LONG = 1024

export async function prepareReference(file: Blob): Promise<ReferenceImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, LONG / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(bitmap, 0, 0, width, height)
    const metrics = measureFrame(ctx.getImageData(0, 0, width, height).data, width, height)
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), metrics, width, height }
  } finally {
    bitmap.close()
  }
}

/** The image blocks and the words that go with them, as a user message's start. */
export function referenceBlocks(refs: ReferenceImage[]) {
  return refs.flatMap((r, i) => [
    { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: r.dataUrl.split(",")[1] } },
    {
      type: "text" as const,
      text: `Reference image ${refs.length > 1 ? i + 1 : ""} (${r.width}×${r.height}) measured the way capture measures a frame: ${JSON.stringify(r.metrics)}`.replace("  ", " "),
    },
  ])
}
