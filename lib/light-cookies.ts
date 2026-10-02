// The built-in light cookies: gobo patterns a spot lamp throws, drawn here
// rather than shipped as files. A cookie is a mask the engine projects along
// the cone (Engine.loadLightCookie) — white lets the light through, black
// blocks it — so a lamp named for one patterns the floor and the cast the way
// a stage light's gobo does.
//
// Drawn once per pattern and kept: a scene that uses one draws it on the first
// lamp that names it, and every lamp after shares the same picture.

export const LIGHT_COOKIES = ["leaves", "window", "blinds", "stars", "dots", "rings"] as const
export type LightCookie = (typeof LIGHT_COOKIES)[number]

export function isLightCookie(v: unknown): v is LightCookie {
  return typeof v === "string" && (LIGHT_COOKIES as readonly string[]).includes(v)
}

const SIZE = 512

/** Mulberry32: the same pattern on every load, so a saved scene looks as it did. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function draw(name: LightCookie, g: OffscreenCanvasRenderingContext2D): void {
  const s = SIZE
  const rnd = random(name.length * 7919 + name.charCodeAt(0))
  g.fillStyle = "#000"
  g.fillRect(0, 0, s, s)
  g.fillStyle = "#fff"
  switch (name) {
    case "leaves": {
      // Sun through foliage: soft overlapping blots, gaps of shade between.
      g.filter = "blur(6px)"
      for (let i = 0; i < 70; i++) {
        g.beginPath()
        g.ellipse(rnd() * s, rnd() * s, 12 + rnd() * 34, 8 + rnd() * 22, rnd() * Math.PI, 0, Math.PI * 2)
        g.fill()
      }
      g.filter = "none"
      break
    }
    case "window": {
      // A four-pane window, its frame and mullions in shadow.
      const m = s * 0.12
      const bar = s * 0.05
      const pane = (s - 2 * m - bar) / 2
      for (const x of [0, 1]) for (const y of [0, 1]) g.fillRect(m + x * (pane + bar), m + y * (pane + bar), pane, pane)
      break
    }
    case "blinds": {
      // Venetian blinds: even slats of light.
      const n = 9
      const step = s / n
      for (let i = 0; i < n; i++) g.fillRect(0, i * step + step * 0.18, s, step * 0.55)
      break
    }
    case "stars": {
      // A scatter of small points, a few brighter.
      for (let i = 0; i < 140; i++) {
        const r = 1.5 + rnd() ** 3 * 7
        g.globalAlpha = 0.55 + rnd() * 0.45
        g.beginPath()
        g.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2)
        g.fill()
      }
      g.globalAlpha = 1
      break
    }
    case "dots": {
      // A regular grid of round spots.
      const n = 7
      const step = s / n
      for (let x = 0; x < n; x++)
        for (let y = 0; y < n; y++) {
          g.beginPath()
          g.arc((x + 0.5) * step, (y + 0.5) * step, step * 0.3, 0, Math.PI * 2)
          g.fill()
        }
      break
    }
    case "rings": {
      // Concentric rings from the cone's middle.
      const n = 6
      for (let i = n; i > 0; i--) {
        g.fillStyle = i % 2 ? "#fff" : "#000"
        g.beginPath()
        g.arc(s / 2, s / 2, (i / n) * s * 0.5, 0, Math.PI * 2)
        g.fill()
      }
      break
    }
  }
}

const drawn = new Map<LightCookie, Promise<ImageBitmap>>()

/** The pattern's picture, drawn on first use and shared after. */
export function lightCookieImage(name: LightCookie): Promise<ImageBitmap> {
  let p = drawn.get(name)
  if (!p) {
    const canvas = new OffscreenCanvas(SIZE, SIZE)
    draw(name, canvas.getContext("2d")!)
    p = createImageBitmap(canvas)
    drawn.set(name, p)
  }
  return p
}
