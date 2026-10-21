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

**Four text sizes, and the cover's title.** `text-2xs` (11px: captions,
counters, chips, kbd) · `text-xs` (12px: the chrome's body, fields, buttons) ·
`text-sm` (14px: dialog and panel titles) · `text-base` (16px: page headings).
`text-display` (28px, `font-display` italic, Instrument Serif) is a scene's
name over its picture and nothing else: the cover's (`SceneName display`), the
gallery stage's and the scene viewer's. `text-billboard` (38px) is the same
title on the gallery's billboard, where the cover fills the page; the same face,
upright at `text-masthead` (18px), sets the REZE DESIGN masthead. Never `text-[Npx]`.
Weights: `font-normal` and `font-medium`; `font-semibold` for page headings
and tiny all-caps labels.

**Two text colours.** `text-foreground` and `text-muted-foreground`, never with
an opacity. A dimmer muted is not a third tier, it is the same tier rendered
inconsistently. If something needs to recede further, it probably should not
be on screen.

**Three accents, one meaning each, always at -400.** `blue-400`
selected/active, as a fill or an underline · `amber-400` warning (it still works, but read this) ·
`red-400` destructive or error. A tinted box uses the accent at an alpha
(`bg-amber-400/10 border-amber-400/30`), with text in the accent itself. No
lighter or darker shades, including on hover: a solid accent button hovers at
`bg-blue-400/90`, and its text is `text-on-accent`, never `text-white`.
Outlines are in the ink: a focus ring, a focused field's border, a picked
tile's or a drop target's bound are `foreground`, never an accent.

**The cover.** The editor's resting chrome is type set straight on the canvas,
no boxes: the scene's name and a mono line of facts (model · motion · music), a
numbered index with the chosen pane beside it past a hairline, a top row of
words with the centred wordmark as the file menu, and the transport as one line
along the bottom. Mark such type `cover-type`; inside it, `<Cover>`
(`components/ui/cover.tsx`) gives sliders their `hairline` look and tab bars
their underlined words, and every overlay resets it. Its ink follows the
scene (`data-ink` on `<main>`, "The cover" in
`app/globals.css`): pure black over a light scene, pure white over a dark one,
each character with a dark shadow (a soft edge under white type, one tight
drop under black). The cover and paper (`data-paper`: dialogs, the palette,
the gallery) have ONE ink: `text-muted-foreground` resolves to it there, and
grey (0.44 under black, 0.78 under white) is kept for disabled controls. No washes or glows behind it. The open timeline is
paper too, on the side opposite the cover's ink, with no edge. The floating
editors (graph, WGSL, grade) are solid black in the dark paper's ink and
hairline, whatever the scene; the code view keeps its own ground
(`data-ground="code"`). The material tree, AI panel and publish keep surfaces.
A device with no mouse or trackpad (a phone or a tablet) only plays: the
editor shows it the scene, the masthead, the gallery and the transport.

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

**One motion duration: 233ms** (`--default-transition-duration` in
`app/globals.css`). A transition with no duration takes it, a class states it
as `duration-233`, and CSS keyframes read the variable. No other duration.

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
- the avatar swatches (`library-rail.tsx`);
- shader socket colours (Blender's data-type code, `reze-node.tsx`);
- the axis colours, X red · Y green · Z blue (`AXIS` in `lib/animation.ts`),
  one set for every channel with an axis, mid tones that hold on either sheet;
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
  A test that needs built-ins imports `@/lib/test-builtins.mts` first; it
  reads them from the database in `.env.local`.

# The library: built-ins, community items, drafts

Grades, shader graphs and effects come from three places: built-ins, community
items (published rows) and local drafts (`lib/drafts.ts`, in localStorage,
never on the server).

**Built-ins are rows too**: every public grade, graph and effect owned by the
first of `ADMIN_EMAILS` (`lib/builtin-rows.ts`). The editor waits for the whole
shelf from `/api/library/builtins` before it starts (`lib/builtins.ts`,
`hooks/use-builtins.ts`); a scene page gets the rows its document names from
the server. Read them through `builtinGraphs()`, `builtinEffects()` and
`builtinGrades()`, never at module scope. Change one by publishing over it as
that account, or with a script (`scripts/lib/builtins-db.mjs`) followed by
`npm run db:refresh`. Chinese names and descriptions are the row's `name_zh`
and `description_zh`.

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
- The AI runs on each person's own key, called from the browser and not
  recorded. Premium (the server's key for hand-picked accounts on the deployed
  site) ended on 2026-10-11; there are no premium-only features or limits.
- Under `next dev` only, `app/api/agent/route.ts` still offers the server's
  key (`lib/ai/premium.ts`: Anthropic's from `.env.local`) to the developer.
  It is the only place `ai_usage` is recorded. `AGENT_DEV_OPEN=1`, or no
  database, files dev turns under `"dev"`, which is not recorded.
- **Verified** (`user.verified`, granted from /admin) marks a maker we vouch
  for: a check in Reze's violet (`components/verified-badge.tsx`) beside
  their name on their published work and their page.

# Auth and admin

- Sessions ride a 5-minute signed cookie cache (`lib/auth.ts`). Account fields
  read from the session, including `verified` and `banned`, can be up to 5 minutes
  stale for that user. An admin change to someone else reaches them when their
  cookie expires. Changes to your own account re-read the session with
  `disableCookieCache` (`app/admin/user-actions.tsx`). A ban also blocks new
  sign-ins (the `session.create` hook). It does not end sessions that already
  exist.
- `/api/admin/refresh` clears the `unstable_cache` for library items and scene
  pages (after a direct database migration). It does not touch sessions.
