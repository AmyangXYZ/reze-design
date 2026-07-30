import { LoadingPill } from "@/components/editor/loading-pill"

// Shown the instant a scene link is followed.
//
// Without this, the App Router holds the OLD page on screen while the server
// component runs its query — a round trip to Singapore — and the browser looks
// frozen before jumping abruptly. A loading file turns that into an immediate
// navigation with an honest wait behind it, wearing the same indicator the editor
// uses so the two read as one app.

export default function Loading() {
  return (
    <main className="fixed inset-0 bg-zinc-950">
      <LoadingPill />
    </main>
  )
}
