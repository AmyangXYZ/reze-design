// The stock, whole, and the rendering styles with their makers' graphs:
// what the editor waits on before it starts (lib/stock).
//
// The editor asks for it as `?v=<stamp>` (./stamp). When the stamp is the
// current one, the answer can never change, so the CDN and the browser keep it
// for a year: the shelf leaves the function once per change per region instead
// of once a minute, which was most of the deployment's origin transfer. A stale
// or missing stamp gets the ordinary minute-long cache, so nothing old is ever
// pinned under a new stamp.

import type { NextRequest } from "next/server"
import { stockShelf, stockStamp } from "@/lib/stock-rows"
import { stampedJson } from "@/lib/cdn"

export async function GET(request: NextRequest) {
  const [shelf, stamp] = await Promise.all([stockShelf(), stockStamp()])
  return stampedJson(shelf, stamp, request.nextUrl.searchParams.get("v"))
}
