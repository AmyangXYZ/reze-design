// What Reze Design keeps about you, and what stays in your browser.

import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy · Reze Design",
  description: "What Reze Design stores for an account, and what never leaves your browser.",
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{children}</h2>
}

export default function PrivacyPage() {
  return (
    // Black across the full width, with the reading column centred inside it —
    // the root body paints the editor's scene colour, and a max-width main would
    // have let it back in down both margins.
    <main className="w-full flex-1 bg-black px-6 py-12 text-sm sm:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-lg font-semibold">Privacy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Rendering a video happens entirely in your browser — the frames, the encode and the file never touch a
          server.
        </p>

        <section className="mt-10 border-t border-line pt-6">
          <Heading>Accounts</Heading>
          <p className="mt-2 text-sm text-muted-foreground">
            An account stores the email you signed in with, your username and avatar, and the scenes and presets you
            publish. Published items are public; private ones are visible to you alone. Deleting an account removes it
            and leaves the items you published in place, unattributed.
          </p>
        </section>
      </div>
    </main>
  )
}
