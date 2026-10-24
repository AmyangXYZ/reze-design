// The stock, whole: what the editor waits on before it starts (lib/stock).

import { stockRows } from "@/lib/stock-rows"
import { publicJson } from "@/lib/cdn"

export async function GET() {
  return publicJson({ items: await stockRows() })
}
