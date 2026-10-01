// Which reze-engine `.next` was built against — and a clean `.next` when that
// changes.
//
// Switching between the local checkout (`npm i ../reze-engine/engine`, a link)
// and a published version (`npm i reze-engine@x.y.z`) leaves `.next` holding
// modules compiled from the other one, and the dev server serves a mix of the
// two until `.next` is deleted by hand. Run before `dev` and `build` (the npm
// `predev` / `prebuild` hooks): it reads where node_modules/reze-engine really
// points and its version, compares them with the stamp `.next` was built
// under, and removes `.next` when they differ. The same engine twice costs one
// stat and nothing else.

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs"
import { join } from "path"

const root = process.cwd()
const nextDir = join(root, ".next")
const stampFile = join(nextDir, "engine-stamp.json")

let engine
try {
  const dir = realpathSync(join(root, "node_modules", "reze-engine"))
  const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  engine = { dir, version }
} catch {
  // No engine installed yet: nothing to compare against, and nothing to clean.
  process.exit(0)
}

let built = null
try {
  built = JSON.parse(readFileSync(stampFile, "utf8"))
} catch {
  // No stamp: a fresh .next, or one from before this script — clean it once if it exists.
}

const same = built && built.dir === engine.dir && built.version === engine.version
if (!same && existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true })
  console.log(`[engine] reze-engine ${engine.version} at ${engine.dir} — cleared .next`)
}
mkdirSync(nextDir, { recursive: true })
writeFileSync(stampFile, JSON.stringify(engine))
