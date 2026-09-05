// Publish dates for the built-in library, recovered from git.
//
// Built-ins ship in content/*.json and have no row of their own to carry a
// createdAt, so the library had nothing to show in its Published column and
// nothing to rank them by. The repo does know: a built-in's date is the last
// commit that changed THAT ITEM, which is what its author would call it.
//
// Per item, not per file — one commit usually touches a single effect, and
// dating thirty effects by the file's last commit would make them all the same
// day. Walk each file's history oldest to newest and record, for every id, the
// commit where its serialized content last differed.
//
// Regenerate with: node scripts/builtin-dates.mjs --write

import { execFileSync } from "node:child_process"
import fs from "node:fs"

const FILES = ["content/effects.json", "content/grades.json", "content/graphs.json", "content/stage-graphs.json"]
const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 })

const dates = {}

for (const file of FILES) {
  // Oldest first, so a later commit overwrites an earlier one for the same item.
  const log = git(["log", "--reverse", "--format=%H %aI", "--", file]).trim().split("\n").filter(Boolean)
  let prev = new Map()
  for (const line of log) {
    const [sha, iso] = line.split(" ")
    let items
    try {
      items = JSON.parse(git(["show", `${sha}:${file}`]))
    } catch {
      continue // the file did not exist, or was not valid JSON at that commit
    }
    const now = new Map()
    for (const it of Array.isArray(items) ? items : Object.values(items)) {
      if (!it?.id) continue
      const body = JSON.stringify(it)
      now.set(it.id, body)
      if (prev.get(it.id) !== body) dates[it.id] = iso
    }
    prev = now
  }
}

const sorted = Object.fromEntries(Object.entries(dates).sort(([a], [b]) => a.localeCompare(b)))
const out = "content/builtin-dates.json"
if (process.argv.includes("--write")) {
  fs.writeFileSync(out, JSON.stringify(sorted, null, 1) + "\n")
  console.log(`wrote ${out} — ${Object.keys(sorted).length} items`)
} else {
  console.log(`${Object.keys(sorted).length} items (dry run; pass --write)`)
  for (const [id, iso] of Object.entries(sorted).slice(0, 5)) console.log(`  ${id} ${iso}`)
}
