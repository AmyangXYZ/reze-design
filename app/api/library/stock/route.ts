// The stock, whole, and the rendering styles with their makers' graphs:
// what the editor waits on before it starts (lib/stock).

import { stockRows, styleGraphRows, styleRows } from "@/lib/stock-rows"
import { publicJson } from "@/lib/cdn"

export async function GET() {
  const [items, styles, styleGraphs] = await Promise.all([stockRows(), styleRows(), styleGraphRows()])
  return publicJson({ items, styles, styleGraphs })
}
