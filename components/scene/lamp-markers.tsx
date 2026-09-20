"use client"

// A lamp's icon, over the canvas rather than inside it.
//
// The overlay pass draws wireframes in world space, which is right for a volume
// and wrong for an icon: a ring sized in world units balloons as you zoom, and a
// glyph made of line segments cannot face the camera the way its ring does. A
// DOM element is the opposite on both counts — it is a real lucide glyph at a
// real pixel size, it takes pointer events without a hit test, and the browser
// handles its focus ring and its tooltip.
//
// What stays in the overlay pass is what is genuinely three-dimensional: the
// sphere that shows a lamp's reach, and the dashed line to the floor under it.
// Those want perspective. An icon does not.

import { useEffect, useRef } from "react"
import { Sun } from "lucide-react"
import type { Engine } from "reze-engine"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SceneLight } from "@/lib/scene"

export function LampMarkers({
  lights,
  openId,
  onPick,
  engineRef,
  style,
}: {
  lights: SceneLight[]
  /** Which lamp's panel is open — the one drawn as selected. */
  openId: string | null
  onPick: (id: string) => void
  engineRef: React.RefObject<Engine | null>
  /** The canvas's own frame, so the markers sit exactly over it. */
  style?: React.CSSProperties
}) {
  const nodes = useRef(new Map<string, HTMLButtonElement | null>())

  // PLACED ON A FRAME LOOP, because nothing announces a camera move. Orbiting is
  // a drag on the canvas that changes no React state — that is deliberate, it is
  // how looking at a scene stays distinct from editing it — so there is no event
  // to subscribe to and a marker that updated on render would lag the thing it
  // marks. Written straight to style.transform rather than through state: sixty
  // renders a second of a list that has not changed is work with nothing to show
  // for it.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const engine = engineRef.current
      if (!engine) return
      for (const l of lights) {
        const el = nodes.current.get(l.id)
        if (!el) continue
        const p = engine.worldToScreen({ x: l.position[0], y: l.position[1], z: l.position[2] })
        // Behind the camera, which is not the same as off-screen: a point behind
        // you projects to a mirrored position in front of you, and drawn it is a
        // marker sitting where its lamp certainly is not.
        if (!p) {
          el.style.visibility = "hidden"
          continue
        }
        el.style.visibility = ""
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [lights, engineRef])

  return (
    <div className="pointer-events-none absolute inset-0 z-10" style={style}>
      {lights.map((l) => {
        const off = l.on === false
        return (
          <Button
            key={l.id}
            ref={(el) => {
              nodes.current.set(l.id, el)
            }}
            variant="ghost"
            size="icon"
            title={l.name}
            onClick={() => onPick(l.id)}
            // top/left 0 and everything through transform: the frame loop writes
            // one property, and a transform is the one the compositor can take
            // without laying the page out again.
            // SELECTION AND HOVER ARE NOT THE SAME CHANNEL. Both once wrote the
            // background, so hovering the selected marker restyled the one thing
            // that was already emphasised — the state went one way and the
            // affordance went the other, over the same pixels. Selection is a
            // black disc and it is final; hover is offered only where there is
            // no selection to argue with. A pointer can then never weaken what a
            // click established.
            //
            // At rest the glyph stands alone, and its shadow is what separates
            // it from the scene behind it.
            // The dark: twin of every background is written out, because the
            // ghost variant carries `dark:hover:bg-accent/50` and that is a
            // DIFFERENT merge key from `hover:bg-*` — a plain hover override
            // leaves it standing, and in dark mode it is the one that wins. It
            // put a solid grey disc behind a glyph asking for five per cent.
            className={cn(
              "pointer-events-auto absolute top-0 left-0 rounded-full transition-colors",
              openId === l.id
                ? "bg-black/10 hover:bg-black/10 dark:hover:bg-black/10"
                : "hover:bg-black/5 dark:hover:bg-black/5",
            )}
            // THE COLOUR GOES ON THE GLYPH, not on the button. A ring's colour
            // falls back to currentColor, so tinting the button tinted its
            // border too and every lamp had a ring of its own hue — the border
            // says "control", which is chrome's to say, and only the light
            // itself carries the light's colour.
            style={{ visibility: "hidden" }}
          >
            {/* FILLED, and not for decoration: an outline glyph over a lit
                scene is a few stroked pixels competing with whatever is behind
                them, and the core is what says "the light is HERE". Lucide's Sun
                is a circle and eight lines, so the fill lands on the core and
                leaves the rays as rays.

                The shadow is the same argument. A marker is drawn over content
                it knows nothing about, and a pale lamp against a pale sky is
                invisible without one — which is why every DCC outlines its
                gizmos rather than trusting the colour alone. */}
            <Sun
              className={cn("size-6 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]", off && "text-muted-foreground")}
              style={off ? undefined : { color: l.color }}
              fill="currentColor"
              strokeWidth={2.25}
            />
          </Button>
        )
      })}
    </div>
  )
}
