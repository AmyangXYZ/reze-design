// Gallery (placeholder) — the public wall of shared scenes. Each card will link
// to a permanent, always-on live 3D scene at /[user]/[scene] once accounts +
// persistence land. For now it renders dummy cards so the shell reads as a
// product, plus the empty-state that explains what will fill it.

import { SiteHeader } from "@/components/site-header"

const PLACEHOLDERS = [
  { user: "you", scene: "neon-rooftop", title: "Neon Rooftop" },
  { user: "you", scene: "studio-ballad", title: "Studio Ballad" },
  { user: "you", scene: "sakura-stage", title: "Sakura Stage" },
  { user: "you", scene: "midnight-city", title: "Midnight City" },
  { user: "you", scene: "aurora-dance", title: "Aurora Dance" },
  { user: "you", scene: "glass-atrium", title: "Glass Atrium" },
]

export default function GalleryPage() {
  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-200">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Gallery</h1>
            <p className="mt-1 text-sm text-muted-foreground">Shared scenes, live in 3D. Publishing arrives with accounts.</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PLACEHOLDERS.map((s, i) => (
            <div
              key={s.scene}
              className="group overflow-hidden rounded-xl border border-white/10 bg-zinc-900/40 transition-colors hover:border-white/20"
            >
              <div
                className="aspect-video w-full"
                style={{
                  background: `linear-gradient(135deg, hsl(${(i * 47) % 360} 45% 22%), hsl(${(i * 47 + 40) % 360} 55% 12%))`,
                }}
              />
              <div className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-zinc-200">{s.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    reze.design/{s.user}/{s.scene}
                  </div>
                </div>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
                  Soon
                </span>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
