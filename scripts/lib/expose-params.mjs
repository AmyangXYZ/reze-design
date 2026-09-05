// Turn an effect's hand-tuned consts into declared parameters.
//
// A tunable stops being a compile-time `const` and becomes a field of the
// uniform the engine codegens from the `#param` lines, so every reference has to
// become `params.NAME`. Mechanical, and worth doing mechanically: done by hand
// across thirty shaders it is one missed rename away from a shader that compiles
// and reads a stale constant.
//
// Shared by the two callers that need it — the repo's built-ins in
// content/effects.json, and published rows in the database — because they must
// transform source the SAME way. Two copies of a rename this precise is two
// copies that drift, and the second one is the one nobody tests.

/** A const another const is BUILT FROM cannot become a param: `params.X` is a
 *  uniform read, not a const-expression, so a module-scope const initialised
 *  from it will not compile, and neither will an array sized by it. Refused
 *  here rather than discovered as a broken effect. */
function refuseIfStructural(wgsl, key, label) {
  const others = [...wgsl.matchAll(/^const (\w+)\s*(?::[^=]+)?=\s*([^;]+);/gm)]
  const dependent = others.filter(([, n, init]) => n !== key && new RegExp(`\\b${key}\\b`).test(init))
  if (dependent.length) {
    throw new Error(`${label}: ${key} is used by ${dependent.map((d) => d[1]).join(", ")} — cannot be a param`)
  }
  if (new RegExp(`array<[^>]*,\\s*${key}\\s*>`).test(wgsl)) {
    throw new Error(`${label}: ${key} sizes an array — cannot be a param`)
  }
}

/**
 * @param wgsl   the effect source
 * @param specs  `NAME`, or `NAME:min:max` for a float that wants a range
 * @param label  what to call this effect in an error
 */
export function exposeParams(wgsl, specs, label) {
  const directives = []

  for (const spec of specs) {
    const [key, lo, hi] = spec.split(":")
    const re = new RegExp(`^const ${key}\\s*(?::[^=]+)?=\\s*([^;]+);([^\\n]*)$`, "m")
    const m = wgsl.match(re)
    if (!m) throw new Error(`${label}: no const named ${key}`)
    refuseIfStructural(wgsl, key, label)

    const raw = m[1].trim()
    const note = m[2].replace(/^\s*\/\/\s*/, "").trim()
    const tail = note ? ` — ${note}` : ""

    const vec = raw.match(/^vec3f\(([^)]+)\)$/)
    if (vec) {
      const comps = vec[1].split(",").map((x) => Number(x.trim()))
      if (comps.length !== 3 || comps.some(Number.isNaN)) throw new Error(`${label}: ${key} is not a vec3f literal`)
      // A vec3 whose components all sit in 0..1 is a colour; anything else is a
      // direction or an offset, and a colour picker would be the wrong control.
      if (comps.every((c) => c >= 0 && c <= 1)) {
        const hex = comps.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")
        directives.push(`#param color ${key} #${hex}${tail}`)
      } else {
        directives.push(`#param vec3 ${key} ${comps.join(" ")}${tail}`)
      }
    } else {
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new Error(`${label}: ${key} is not a scalar literal (${raw})`)
      const range = lo !== undefined && hi !== undefined ? ` ${lo} ${hi}` : ""
      directives.push(`#param float ${key} ${n}${range}${tail}`)
    }

    // Drop the const, then rename every remaining mention. Word-boundary
    // matched, so FALL does not touch FALLOFF.
    wgsl = wgsl.replace(re, "").replace(new RegExp(`\\b${key}\\b`, "g"), `params.${key}`)
  }

  // Directives belong at the top, under any that are already there.
  const lines = wgsl.split("\n")
  let at = 0
  while (at < lines.length && (/^\s*#/.test(lines[at]) || lines[at].trim() === "")) at++
  wgsl = [...lines.slice(0, at), ...directives, "", ...lines.slice(at)].join("\n").replace(/\n{3,}/g, "\n\n")

  return { wgsl, directives }
}
