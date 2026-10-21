// The built-ins, whole: what the editor waits on before it starts (lib/builtins).

import { builtinRows } from "@/lib/builtin-rows"
import { publicJson } from "@/lib/cdn"

export async function GET() {
  return publicJson({ items: await builtinRows() })
}
