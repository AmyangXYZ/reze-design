// What an AI-written effect must not do before it is handed to the GPU.
//
// A shader that never finishes does not throw: it stalls the GPU, and the
// browser tab with it, until the driver gives up and loses the device. The
// engine has no watchdog, and WebGPU none either — the compiler cannot know a
// loop's count. So the only defence is to refuse the shapes that can run
// away, before compiling, with a message the model can act on:
//
//   while / loop        unbounded by construction: refused
//   for (…; COND; …)    COND must name a bound we can trust — an integer
//                       literal up to MAX_LITERAL, an rz…Count() (the engine
//                       caps those), arrayLength(…), or a #param (the
//                       engine clamps a dial to its declared range)
//
// This is a guard on the AI's code only. People write effects in the editor
// with their eyes on the canvas and the hand that wrote the loop on the undo
// key; the AI has neither.

/** The largest literal loop bound accepted. Nested loops multiply, so this is
 *  deliberately modest. */
export const MAX_LITERAL = 256

/** The WGSL with comments blanked, so a loop in a comment is not a loop. */
function code(wgsl: string): string {
  return wgsl.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "")
}

const lineOf = (src: string, index: number) => src.slice(0, index).split("\n").length

export function guardLoops(wgsl: string): string[] {
  const src = code(wgsl)
  const problems: string[] = []
  for (const m of src.matchAll(/\b(while|loop)\b\s*[({]/g)) {
    problems.push(`line ${lineOf(src, m.index!)}: \`${m[1]}\` is not allowed in an AI-written effect — use a \`for\` loop with a fixed bound (a literal up to ${MAX_LITERAL}, an rz…Count(), or a #param).`)
  }
  for (const m of src.matchAll(/\bfor\s*\(([^;]*);([^;]*);/g)) {
    const cond = m[2]
    const literals = [...cond.matchAll(/\b(\d+)(?:u|i)?\b/g)].map((x) => Number(x[1]))
    const trusted =
      /\brz\w*Count\s*\(/.test(cond) ||
      /\barrayLength\s*\(/.test(cond) ||
      /\bparams\.\w+/.test(cond) ||
      (literals.length > 0 && literals.every((n) => n <= MAX_LITERAL) && /[<>]=?/.test(cond))
    if (!trusted) {
      problems.push(
        `line ${lineOf(src, m.index!)}: this loop's bound (\`${cond.trim()}\`) is not one that can be trusted to end soon — compare against an integer literal up to ${MAX_LITERAL}, an rz…Count(), arrayLength(…), or a #param.`,
      )
    }
  }
  return problems
}
