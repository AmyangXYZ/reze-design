// The community presets' current stamp (lib/library-rows presetsStamp): a few
// bytes, cached at the CDN for a minute, naming the `?v=` under which the whole
// list (/api/library) is cached for good.

import { presetsStamp } from "@/lib/library-rows"
import { publicJson } from "@/lib/cdn"

export async function GET() {
  return publicJson({ v: await presetsStamp() })
}
