// What the export stats switch sends, in full.
//
// A page rather than a tooltip because the answer has to be checkable by someone
// who did not write it — the switch says the short version, this says all of it,
// and anyone can read it before deciding.

import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy · Reze Design",
  description: "What Reze Design collects when you share export stats, and what never leaves your browser.",
}

const COLLECTED = [
  ["Resolution and aspect ratio", "3840×1608, 2.39:1 — the shape of the file you rendered."],
  [
    "Model filenames",
    "The .pmx names in the scene. Which games' models people bring is what decides which presets get tuned next, and the names are listed publicly on the analysis page.",
  ],
  [
    "Effects, and the dials you moved",
    "Which background effects the scene used, and the parameter values you settled on.",
  ],
  ["Material shader graphs", "Which graphs the cast was wearing, by library id."],
  ["Grade", "Which colour grade, and at what strength."],
  ["Rendering style", "Which look pack this browser is set to."],
  ["The date", "The day, with no time of day."],
]

const NEVER = [
  ["Who you are", "No account id, no name, no email — signed in or not. The rows have no user column at all."],
  ["Your address", "Not stored, not hashed, not derived from."],
  [
    "Your motion and music",
    "Which VMD and which track are what identify the video you are making. They are never sent.",
  ],
  ["Your scene", "The document, its camera, lighting, timeline and lyrics stay on your machine."],
  ["Your models and textures", "The files themselves. Only the .pmx name is read, never the model."],
  [
    "Your file",
    "The name you chose for the video, its size, and the video itself. The render and the encode happen entirely in your browser.",
  ],
]

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{children}</h2>
}

function List({ title, lead, rows }: { title: string; lead: string; rows: string[][] }) {
  return (
    <section className="mt-10">
      <Heading>{title}</Heading>
      <p className="mt-2 text-sm text-muted-foreground">{lead}</p>
      <dl className="mt-4 space-y-3">
        {rows.map(([term, detail]) => (
          <div key={term} className="rounded-interior border border-line bg-surface-raised p-3">
            <dt className="text-sm font-medium text-foreground">{term}</dt>
            <dd className="mt-0.5 text-sm text-muted-foreground">{detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    // Black across the full width, with the reading column centred inside it —
    // the root body paints the editor's scene colour, and a max-width main would
    // have let it back in down both margins.
    <main className="w-full flex-1 bg-black px-6 py-12 text-sm sm:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-lg font-semibold">Privacy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Rendering a video happens entirely in your browser — the frames, the encode and the file never touch a
          server, and nothing you make is uploaded anywhere. The Render panel has one switch,{" "}
          <span className="text-foreground">Share export stats</span>, off until you turn it on. It reports which
          settings and presets a finished video used, so we can see what to improve in rendering. This page is exactly
          what it sends.
        </p>

        <List
          title="What it sends"
          lead="Once, after a video finishes — a cancelled or failed export sends nothing."
          rows={COLLECTED}
        />

        <List
          title="What it never sends"
          lead="Your work stays yours. What you made is never uploaded — not behind a setting, not in a different mode, not in part."
          rows={NEVER}
        />

        <section className="mt-10">
          <Heading>Why</Heading>
          <p className="mt-2 text-sm text-muted-foreground">
            Most finished work leaves as a file and goes up somewhere else, so counting what gets published here counts
            the minority. Knowing which effects, graphs and grades survive all the way to a rendered video is what tells
            us where rendering needs work — which looks hold up, which dials people always have to correct, and which
            models to make sure they work on.
          </p>
        </section>

        <section className="mt-10">
          <Heading>Turning it off</Heading>
          <p className="mt-2 text-sm text-muted-foreground">
            The switch in the Render panel, any time. Your answer is kept in this browser only. If what is collected
            ever widens, the stored answer stops counting and the switch returns to off until you turn it on again.
          </p>
        </section>

        <section className="mt-10 border-t border-line pt-6">
          <Heading>Accounts</Heading>
          <p className="mt-2 text-sm text-muted-foreground">
            An account stores the email you signed in with, your username and avatar, and the scenes and presets you
            publish. Published items are public; private ones are visible to you alone. Deleting an account removes it
            and leaves the items you published in place, unattributed.
          </p>
        </section>
      </div>
    </main>
  )
}
