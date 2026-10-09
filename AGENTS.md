<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Editor chrome

Clean and consistent: few sizes, few colours, the same classes for the same
job, and nothing picked by eye at one call site. The tokens live in
`app/globals.css` under "Editor chrome tokens". `npm run lint:chrome`
(`scripts/check-chrome.mjs`) checks the class scales below, and `npm run lint`
flags raw elements. Out of scope: `components/ui` (the primitives define the
scales) and `app/admin` (its own light theme).

**Four text sizes.** `text-2xs` (11px: captions, counters, chips, kbd) ·
`text-xs` (12px: the chrome's body, fields, buttons) · `text-sm` (14px: dialog
and panel titles) · `text-base` (16px: page headings). Never `text-[Npx]`.
Weights: `font-normal` and `font-medium`; `font-semibold` for page headings
and tiny all-caps labels.

**Two text colours.** `text-foreground` and `text-muted-foreground`, never with
an opacity. A dimmer muted is not a third tier, it is the same tier rendered
inconsistently. If something needs to recede further, it probably should not
be on screen.

**Three accents, one meaning each, always at -400.** `blue-400`
selected/active/focus · `amber-400` warning (it still works, but read this) ·
`red-400` destructive or error. A tinted box uses the accent at an alpha
(`bg-amber-400/10 border-amber-400/30`), with text in the accent itself. No
lighter or darker shades, including on hover: a solid accent button hovers at
`bg-blue-400/90`.

**Surfaces and edges.** `bg-surface` for chrome, `bg-surface-raised` for
anything stacked on it, `bg-background` for a page's own ground. Tints over
them: `bg-white/5` (a field, a well, a thumbnail placeholder) and `bg-white/10`
(hover, pressed). `border-line` divides inside a surface, and
`border-line-strong` bounds a surface or a control (`ring-line-strong` around a
swatch). Nothing dimmer: a past review called unclear borders out by name.

**Radii: `rounded-surface` (12) · `rounded-interior` (8) · `rounded-chip` (6) ·
`rounded-full`.**
- Floating surfaces (dialogs, popovers, menus) use `surface`.
- Panels and thumbnails inside them use `interior`.
- Controls (buttons, fields, chips, rows) use `chip`.
- Pills, dots and avatars use `full`.

Never `rounded`, `-sm`, `-md`, `-lg` or an arbitrary radius.

**Controls are the `components/ui` primitives.** They carry focus handling,
disabled states and sizing. A row, tile, swatch or inline field that brings its
own look uses `<Button variant="bare">` or `<Input variant="bare">`, which keep
those behaviours and add no box to fight. Sticky focus is already handled:
`Button` drops focus after a mouse click, `NoStickyFocus`
(`components/no-sticky-focus.tsx`) does the same app-wide, and
`lib/last-input.ts` handles Radix overlays. That is never a reason for a raw
element. Raw elements that remain on purpose:
- hidden `<input type="file">` pickers;
- the colour wheel's native range input;
- the WGSL editor's transparent overlay `<textarea>`.

The last two carry an `eslint-disable` with the reason.

**Deliberate palettes (the only colours outside the above):**
- the library tag hues (`library-rail.tsx`);
- shader socket colours (Blender's data-type code, `reze-node.tsx`);
- the graph node card's `zinc-900` (canvas content that must stand off the
  canvas);
- Reze's violet brand mark (`--color-reze`);
- the white library-door pills with `text-zinc-950`;
- the white handle on colour pickers;
- white text over cover images;
- the WGSL code view's own ground.

A new one belongs in `scripts/check-chrome.mjs` with its reason.

**The chrome skin carries `backdrop-blur-xs`** (`SKIN` in
`components/editor/surface.tsx`). Its cost over a live canvas was measured and
accepted; the decision is recorded on `--color-surface` in `app/globals.css`.
If the blur ever has to go, drop it there, not per surface.

**Placement carries meaning.** A scrim means the canvas is not part of this
task (publish, export setup). No scrim means you are watching the canvas while
you work (materials, editors, libraries). Wanting a scrim on a side panel means
the placement is wrong. `components/editor/surface.tsx` encodes this for the
panels that use it. Dialogs built on `DialogContent` follow the same rule.

**Publish dialogs share one skin**: the `PUBLISH_*` classes exported from
`publish-button.tsx`, used by the grade, shader and effect form and by the
scene's (`share-scene.tsx`). They have one 16px inset on every side, the close
button on the title row (`DialogContent`'s `closeClassName`), a fixed header, a
scrolling body and a footer holding the submit, all capped at the viewport.

# Commands

- `npm run dev` / `npm run build`: both first run `scripts/engine-stamp.mjs`.
- `npm run lint`: ESLint. `npm run lint:chrome`: the chrome's class scales.
- Tests are plain `*.test.mts` files under `lib/`, with no test runner. Each
  says how to run it at the top, always in this form:
  `npx esbuild <file> --bundle --platform=node --format=esm --tsconfig=tsconfig.json --outfile=/tmp/t.mjs && node /tmp/t.mjs`

# The library: built-ins, community items, drafts

Grades, shader graphs and effects come from three places: built-ins (in the
bundle), community items (published rows) and local drafts (`lib/drafts.ts`,
in localStorage, never on the server).

**A scene recognises published work by VALUE, not by bookkeeping**
(`lib/refs.ts`). A look that equals a published item is pinned by id. Anything
else travels inline. Two consequences:

- **Compare looks with `sameGraphLook` (`lib/materials.ts`) and `sameGradeLook`
  (`lib/grade.ts`), never with `JSON.stringify`.** Published payloads come back
  from Postgres `jsonb`, which reorders object keys, so comparing JSON text
  stops matching the moment a look is published. Effects compare their WGSL
  text, which is a plain string.
- **Publishing a scene is blocked while it wears a look that matches nothing
  reachable** (`unpublishedUses`). So whatever creates a new look, whether a
  person's editor or an AI tool, must save it as a draft. Otherwise the user is
  blocked with nothing to publish. The editors save on close (`app/page.tsx`).
  The AI tools save through the host's `saveGraphDraft` and `saveGradeDraft`,
  and `authorEffect`. When updating a draft in place, find it by `nameKey`.
  New names come from `freeName` (`lib/names.ts`).

# Auto-styling

Every model is auto-styled by ONE classifier, `lib/auto-style.ts`, whatever slot
it was uploaded into. The test that matters is the model, not the slot: **does
it have a head bone** (`isFigure`)?
- A figure gets its parts first (eye, face, hair, skin, socks, stockings,
  metal, cloth), on the current style pack's graphs. Hair and eye carry render
  classes. Then what its materials are made of (glass, wood…).
- Anything without a head gets the material table first (`lib/stage-style.ts`),
  then Stage Surface for converted materials, then only the safe material roles
  (cloth, metal, socks, stockings). It never gets hair, eye, face or skin, so a
  wall can never be drawn in the hair pass.
- Unclaimed materials stay ungrouped, on the neutral default. Grouped materials
  are never touched.

Apply it through `autoStyleOnEngine` (`lib/scene-host.ts`). Character drop
targets (`withSpecialGroups`) follow `isFigureModel`. Don't call the engine's
`autoStyleGroups`: it can't be told to skip the figure roles.

# The AI art director

- Tools live in `lib/ai/*-tools.ts` and run in the browser against the
  `SceneToolHandles` interface (`lib/ai/scene-tools.ts`). `app/page.tsx`
  implements the handles through `useSceneTools`, which refreshes them every
  render and waits a render between tool runs.
- A new handle needs adding in three places: the type, `app/page.tsx` and the
  fake in `lib/ai/tools.test.mts`.
- Premium turns go through `app/api/agent/route.ts`, which holds the server's
  key. It is the only place `ai_usage` is recorded. A turn on the user's own
  key calls the model from the browser and is not recorded.
- `lib/ai/premium.ts`: under `next dev` the server's key is Anthropic's from
  `.env.local`; in production it is OpenAI's. `AGENT_DEV_OPEN=1`, or no
  database, files dev turns under `"dev"`, which is not recorded.

# Auth and admin

- Sessions ride a 5-minute signed cookie cache (`lib/auth.ts`). Account fields
  read from the session, including `plan` and `banned`, can be up to 5 minutes
  stale for that user. An admin change to someone else reaches them when their
  cookie expires. Changes to your own account re-read the session with
  `disableCookieCache` (`app/admin/actions.tsx`). A ban also blocks new
  sign-ins (the `session.create` hook). It does not end sessions that already
  exist.
- `/api/admin/refresh` clears the `unstable_cache` for library items and scene
  pages (after a direct database migration). It does not touch sessions.
