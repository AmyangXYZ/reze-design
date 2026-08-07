<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Editor chrome

The tokens are defined and explained in `app/globals.css` under "Editor chrome
tokens". The rules, short enough to hold in your head:

**Two text colours.** `text-foreground` and `text-muted-foreground`. Never an
opacity on either — a dimmer muted is not a third tier, it is the same tier
rendered inconsistently. If something needs to recede further, it probably
should not be on screen.

**Three accents, one meaning each.** `blue-400` selected/active/focus ·
`amber-400` warning (it still works, but read this) · `red-400` destructive
(this removes something).

**Two surfaces, two edges.** `bg-surface` for chrome, `bg-surface-raised` for
anything stacked on it. `border-line` divides inside a surface,
`border-line-strong` bounds the surface. Nothing dimmer — a past review called
unclear borders out by name.

**Radii: `rounded-surface` (10) · `rounded-interior` (6) · `rounded-chip` (4).**
Avoid 12+; smaller reads as more professional.

**No `backdrop-blur` on chrome that floats over the 3D canvas.** It re-samples
the viewport every frame the scene animates, which is precisely when the chrome
is open. `bg-surface` is opaque enough without it. Blur is fine over something
static.

**Never a raw `<button>`, `<input>` or `<textarea>`.** Use the `components/ui`
primitives — they carry the focus handling, disabled states and sizing, and
`lib/last-input.ts` fixes Radix's sticky focus ring for every overlay. A bare
element silently opts out of all of it. If a primitive does not fit, extend the
primitive.

**Placement carries meaning.** `components/editor/surface.tsx` — a scrim means
the canvas is not part of this task; no scrim means you are watching the canvas
while you work. Wanting a scrim on a side panel means the placement is wrong.
