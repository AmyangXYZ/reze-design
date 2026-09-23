// What the engine actually holds, as one line.
//
// The editor and the viewer boot the same document through the same loader, so
// when a scene looks different in the two of them the disagreement is in what
// reached the engine — and neither host's own lists can show it. This can:
// two entries for one stage means a replace left a model behind and every
// transparent surface is drawing twice; a high `ungrouped` means the groups
// compiled and claimed nothing, leaving those materials on the default graph.
// Both read as "brighter".
//
// One function rather than a copy per host, because a format that exists twice
// stops being comparable the moment one copy gains a field.

import type { Engine } from "reze-engine"

export function drawStatsLine(engine: Engine | null | undefined): string {
  if (!engine) return ""
  const stats = engine.getDrawStats() ?? []
  const bg = engine.getBackgroundState()
  return (
    stats.map((s) => `${s.model} ${s.materials}m ${s.opaque}o/${s.transparent}t ${s.grouped}g/${s.ungrouped}u`).join(" · ") +
    (bg ? ` | bg mode ${bg.mode} x${bg.level.toFixed(2)}${bg.backdrop ? " backdrop" : ""}${bg.world ? " world" : ""}` : "")
  )
}
