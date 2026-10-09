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

**Radii: `rounded-surface` (12) · `rounded-interior` (8) · `rounded-chip` (6).**
Reach for the token, never `rounded-xl`/`rounded-lg` at a call site — the value
lives in `app/globals.css` and changes there.

**The chrome skin carries `backdrop-blur-xs`** (`SKIN` in
`components/editor/surface.tsx`). Its cost over a live canvas was measured and
accepted; the decision is recorded on `--color-surface` in `app/globals.css`.
If the blur ever has to go, drop it there, not per surface.

**Never a raw `<button>`, `<input>` or `<textarea>`.** Use the `components/ui`
primitives — they carry the focus handling, disabled states and sizing, and
`lib/last-input.ts` fixes Radix's sticky focus ring for every overlay. A bare
element silently opts out of all of it. If a primitive does not fit, extend the
primitive.

**Placement carries meaning.** `components/editor/surface.tsx` — a scrim means
the canvas is not part of this task; no scrim means you are watching the canvas
while you work. Wanting a scrim on a side panel means the placement is wrong.

The publish dialogs (grade, shader and effect in `publish-button.tsx`, the
scene in `share-scene.tsx`) share one skin: the `PUBLISH_*` classes exported
from `publish-button.tsx`. They have a fixed header, a body that scrolls and a
footer holding the submit, all capped at the viewport. A new publish form takes
those classes rather than restating them.

# Commands

- `npm run dev` / `npm run build`: both first run `scripts/engine-stamp.mjs`.
- `npm run lint`: ESLint.
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
