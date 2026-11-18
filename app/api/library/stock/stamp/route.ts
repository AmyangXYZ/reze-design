// The stock's current stamp (lib/stock-rows stockStamp): a few bytes, cached
// at the CDN for a minute like any public read, naming the `?v=` under which
// the whole shelf is cached for good.

import { stockStamp } from "@/lib/stock-rows"
import { publicJson } from "@/lib/cdn"

export async function GET() {
  return publicJson({ v: await stockStamp() })
}
