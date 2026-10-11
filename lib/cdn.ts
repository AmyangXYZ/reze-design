import "server-only"
import { NextResponse } from "next/server"

// Public reads, cached at Vercel's CDN, so the requests every open tab makes
// (and retries, and polls) are answered at the edge without starting a function
// or waking the database.
//
// `Vercel-CDN-Cache-Control` and not `Cache-Control: s-maxage`: Cloudflare sits
// in front of Vercel and would honour s-maxage too, but a publish only clears
// Vercel's side (lib/public-pages), so a copy held in Cloudflare could go stale
// with nothing to clear it. This header is Vercel's alone; Cloudflare keeps
// passing these responses through, as it does every API response.
//
// 60s, because revalidateTag does not purge a CDN copy, only the data cache
// behind it: a publish reaches everyone else within a minute, and the
// publisher sees their own at once (the client merges it, and /mine has it).
// For five minutes after that the CDN serves the stale copy while it
// refreshes in the background, so nobody waits on the refresh; past that a
// request waits for a fresh one (the query result behind it is cached too, so
// that is quick). Not longer: on a quiet site the first visitor after a long
// gap would be handed an hours-old list. At most one function run, and one
// database query when something changed, a minute, however many readers.
//
// The browser keeps nothing (`max-age=0`): the client holds its own saved
// copy (lib/saved), which it can show offline and the HTTP cache cannot.
//
// ONLY for responses identical for everyone. Anything read from a session
// belongs in /api/library/mine, which is never cached.
export function publicJson(body: unknown): NextResponse {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Vercel-CDN-Cache-Control": "max-age=60, stale-while-revalidate=300",
    },
  })
}
