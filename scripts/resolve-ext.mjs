// reze-engine's dist is emitted with EXTENSIONLESS relative imports — its
// tsconfig targets a bundler, and Next resolves them without help. Plain node
// cannot: `./engine` is not a file. This hook retries such a specifier with
// ".js", which is what the package meant all along.
//
// A copy of the one in the engine's own test harness, deliberately. Reaching
// across to `../reze-engine/engine/tests/register.mjs` would make a script in
// this repo depend on a sibling checkout being present — true on the machine
// that wrote it and on no other.
//
//   node --import ./scripts/register.mjs scripts/<whatever>.mjs
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
    try {
      return await next(specifier + ".js", context)
    } catch {
      try {
        return await next(specifier + "/index.js", context)
      } catch {
        // fall through, so the error names the specifier rather than the retry
      }
    }
  }
  return next(specifier, context)
}
