// Library (placeholder) — browsable node-graph packs per material slot. The
// "Presets" row is seeded from the real engine presets (SLOT_GRAPHS) so it is
// already meaningful; "Community" is the empty-state for user-contributed graphs
// that arrives with accounts. Clicking a preset will eventually drop it onto the
// active slot in the editor.

import { CircleDashed } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { SLOT_ICONS } from "@/components/scene/slot-icons"
import { SLOT_GRAPHS, SLOT_LABELS } from "@/lib/materials"
import type { MaterialPreset } from "reze-engine"

export default function LibraryPage() {
  const presets = Object.keys(SLOT_GRAPHS) as MaterialPreset[]
  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-200">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Node graph library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Material node graphs, ready to drop onto a slot. Presets ship with the engine; community packs are coming.
        </p>

        <h2 className="mt-8 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Presets</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {presets.map((slot) => {
            const Icon = SLOT_ICONS[slot] ?? CircleDashed
            return (
              <div
                key={slot}
                className="flex flex-col items-start gap-3 rounded-xl border border-white/10 bg-zinc-900/40 p-4 transition-colors hover:border-white/20"
              >
                <div className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                  <Icon className="size-5 text-pink-300" />
                </div>
                <div>
                  <div className="text-sm text-zinc-200">{SLOT_LABELS[slot]}</div>
                  <div className="text-xs text-muted-foreground">Built-in preset</div>
                </div>
              </div>
            )
          })}
        </div>

        <h2 className="mt-10 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Community</h2>
        <div className="mt-3 flex items-center justify-center rounded-xl border border-dashed border-white/10 bg-zinc-900/20 px-6 py-14 text-center text-sm text-muted-foreground">
          User-contributed graphs will show up here once accounts land.
        </div>
      </main>
    </div>
  )
}
