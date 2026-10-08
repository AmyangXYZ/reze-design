// Several captures as ONE picture, each labelled in its corner.
//
// A model reading four separate images pays for four, and has to hold the
// first in mind while it reads the last. A contact sheet costs about one and
// puts the comparison where comparisons are made — side by side. Used for
// trial angles, before/after, and a strip of moments through the song.

/** Lay `frames` out `cols` across, at the frames' own size, labels drawn on.
 *  Returns a JPEG data URL. Browser only. */
export async function contactSheet(frames: { blob: Blob; label: string }[], cols = Math.min(frames.length, 2)): Promise<string> {
  const bitmaps = await Promise.all(frames.map((f) => createImageBitmap(f.blob)))
  try {
    const w = bitmaps[0].width
    const h = bitmaps[0].height
    const rows = Math.ceil(bitmaps.length / cols)
    const gap = 4
    const canvas = document.createElement("canvas")
    canvas.width = cols * w + (cols - 1) * gap
    canvas.height = rows * h + (rows - 1) * gap
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const size = Math.max(12, Math.round(Math.min(w, h) / 18))
    ctx.font = `600 ${size}px system-ui, sans-serif`
    ctx.textBaseline = "top"
    bitmaps.forEach((b, i) => {
      const x = (i % cols) * (w + gap)
      const y = Math.floor(i / cols) * (h + gap)
      ctx.drawImage(b, x, y, w, h)
      const label = frames[i].label
      const pad = Math.round(size / 3)
      const tw = ctx.measureText(label).width
      ctx.fillStyle = "rgba(0,0,0,0.65)"
      ctx.fillRect(x, y, tw + pad * 2, size + pad * 2)
      ctx.fillStyle = "#fff"
      ctx.fillText(label, x + pad, y + pad)
    })
    return canvas.toDataURL("image/jpeg", 0.85)
  } finally {
    for (const b of bitmaps) b.close()
  }
}
