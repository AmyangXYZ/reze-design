"use client"

// The account control: a sign-in dialog when signed out, a small menu when in.
//
// Google, GitHub, or a code sent by email. Each proves email ownership on its
// own, so we owe users neither a verification flow nor a password reset — and
// store no password hashes at all.

import { useEffect, useState, type ReactNode } from "react"
import { ArrowUpRight, CircleUserRound, GalleryThumbnails, Heart, House, LogOut, Palette, Sparkles, WandSparkles, Workflow } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { GithubMark, GoogleMark } from "@/components/icons"
import { authClient, signIn, signOut, useSession } from "@/lib/auth-client"
import { useI18n, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const PROVIDERS = [
  { id: "google", label: "Google", Mark: GoogleMark },
  { id: "github", label: "GitHub", Mark: GithubMark },
] as const

function SignInForm() {
  const t = useT()
  // null while unknown, so buttons don't flash in as the dialog opens.
  const [available, setAvailable] = useState<string[] | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    void fetch("/api/oauth-providers")
      .then((r) => r.json())
      .then((d: { providers?: string[] }) => {
        if (!stale) setAvailable(d.providers ?? [])
      })
      .catch(() => {
        if (!stale) setAvailable([])
      })
    return () => {
      stale = true
    }
  }, [])

  if (available === null) {
    return <div className="py-4 text-center text-xs text-muted-foreground">{t.account.working}</div>
  }
  // A clone with no OAuth secrets says so, rather than showing dead buttons.
  if (available.length === 0) {
    return <div className="py-4 text-center text-xs text-muted-foreground">{t.account.notConfigured}</div>
  }

  const social = PROVIDERS.filter((p) => available.includes(p.id))
  return (
    <div className="space-y-2">
      {social.map(({ id, label, Mark }) => (
        <Button
          key={id}
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => {
            setPending(id)
            // Come back to the scene the user was looking at, not the app root.
            void signIn.social({ provider: id, callbackURL: window.location.href })
          }}
          className="h-10 w-full gap-2.5 border-line-strong bg-white/5 text-xs font-medium hover:bg-white/10"
        >
          <Mark className="size-4" />
          {pending === id ? t.account.working : t.account.continueWith(label)}
        </Button>
      ))}
      {available.includes("email") && (
        <>
          {social.length > 0 && (
            <div className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground">
              <span className="h-px flex-1 bg-line" />
              {t.account.or}
              <span className="h-px flex-1 bg-line" />
            </div>
          )}
          <EmailCodeForm />
        </>
      )}
    </div>
  )
}

/** Email, then the 6-digit code sent to it. The session lands in this tab, so
 *  it works when the mail is read on another device. */
function EmailCodeForm() {
  const { t, locale } = useI18n()
  const [email, setEmail] = useState("")
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Seconds until "Send again" works. The server enforces the same minute.
  const [wait, setWait] = useState(0)
  useEffect(() => {
    if (wait <= 0) return
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  const send = async (to: string) => {
    setBusy(true)
    setError(null)
    const { error } = await authClient.emailOtp.sendVerificationOtp(
      { email: to, type: "sign-in" },
      { headers: { "x-reze-locale": locale } },
    )
    setBusy(false)
    if (error) return setError(t.account.sendFailed)
    setSentTo(to)
    setCode("")
    setWait(60)
  }

  const verify = async () => {
    if (!sentTo) return
    setBusy(true)
    setError(null)
    const { error } = await signIn.emailOtp({ email: sentTo, otp: code })
    setBusy(false)
    if (error) setError(t.account.badCode)
  }

  const field = "h-10 border-line-strong bg-white/5 text-xs"
  const submit = "h-10 w-full text-xs font-medium"

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (busy) return
        if (sentTo) void verify()
        else if (email.trim()) void send(email.trim())
      }}
    >
      {sentTo ? (
        <>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t.account.codeSentTo(sentTo)}</p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="000000"
            className={cn(field, "text-center font-mono tracking-[0.4em]")}
          />
          <Button type="submit" disabled={busy || code.length !== 6} className={submit}>
            {busy ? t.account.working : t.account.verifyCode}
          </Button>
          <div className="flex justify-between">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setSentTo(null)} className="h-7 px-1 text-[11px] text-muted-foreground">
              {t.account.otherEmail}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy || wait > 0} onClick={() => void send(sentTo)} className="h-7 px-1 text-[11px] text-muted-foreground tabular-nums">
              {wait > 0 ? `${t.account.sendAgain} (${wait})` : t.account.sendAgain}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder={t.account.emailPlaceholder}
            className={field}
          />
          <Button type="submit" variant="outline" disabled={busy || !email.trim()} className={cn(submit, "border-line-strong bg-white/5 hover:bg-white/10")}>
            {busy ? t.account.working : t.account.sendCode}
          </Button>
        </>
      )}
      {error && <p className="select-text text-[11px] text-amber-400">{error}</p>}
    </form>
  )
}

type MeStats = { scene: number; effect: number; grade: number; graph: number; likes: number }

// Cached across opens, and warmed as soon as there's a session — the query runs in
// Singapore, so a fetch started when the popover opens has already lost. Stale
// numbers show instantly and are replaced when the fresh ones land.
let cached: MeStats | null = null

function fetchMe(): Promise<MeStats | null> {
  return fetch("/api/me")
    .then((r) => r.json())
    .then((d: { stats?: MeStats }) => {
      cached = d.stats ?? null
      return cached
    })
    .catch(() => null)
}

/** What you've published and how it landed — the reason to have an account. */
function Portfolio({
  handle,
  onOpenLibrary,
}: {
  handle: string | null
  onOpenLibrary?: (kind: LibraryDoor, facet: "yours" | "liked") => void
}) {
  const t = useT()
  const [stats, setStats] = useState<MeStats | null>(cached)
  useEffect(() => {
    let stale = false
    void fetchMe().then((s) => {
      if (!stale && s) setStats(s)
    })
    return () => {
      stale = true
    }
  }, [])

  // An em dash while unknown, never 0 — showing "0 scenes" to someone with six is
  // worse than showing nothing.
  const n = (v: number | undefined) => (stats ? v : "—")
  // Every count is a way in: a number you can't act on is trivia.
  const cells = [
    { key: "scene" as const, icon: GalleryThumbnails, label: t.account.scenesPublished, onClick: () => onOpenLibrary?.("scene", "yours") },
    { key: "effect" as const, icon: Sparkles, label: t.account.effects, onClick: () => onOpenLibrary?.("effect", "yours") },
    { key: "grade" as const, icon: Palette, label: t.account.grades, onClick: () => onOpenLibrary?.("grade", "yours") },
    { key: "graph" as const, icon: Workflow, label: t.account.graphs, onClick: () => onOpenLibrary?.("graph", "yours") },
  ]

  return (
    // Rows, not a grid of numbers. A 4-up grid of counts is a dashboard widget;
    // an account menu is a list of places you can go, and each row is one — label
    // left, count right, the whole row a target. Likes sit with them because it is
    // the same kind of fact, not a footnote in a different size.
    <div className="border-t border-line py-1">
      {/* Each row is a door out of this menu, so each row closes it. Left open,
          the panel stayed floating over the library it had just summoned —
          pointing at the thing you asked for while covering it. */}
      {/* Your page — what you hand people. A new tab, so the scene being worked
          on stays open behind it. */}
      {handle && (
        <PopoverClose asChild>
          <Link
            href={`/${handle}`}
            target="_blank"
            rel="noopener"
            className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-white/5"
          >
            <House className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{t.account.profile}</span>
            <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
          </Link>
        </PopoverClose>
      )}
      {cells.map((c) => (
        <PopoverClose key={c.key} asChild>
          <button
            type="button"
            onClick={c.onClick}
            className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-white/5"
          >
            <c.icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{c.label}</span>
            <span className="shrink-0 font-mono text-[13px] text-foreground">{n(stats?.[c.key])}</span>
          </button>
        </PopoverClose>
      ))}
      {/* Every library has a Liked shelf and nothing in the product opened one.
          Scenes, because that is where likes mostly land and the gallery is the
          surface that can page them. */}
      <PopoverClose asChild>
        <button
          type="button"
          onClick={() => onOpenLibrary?.("scene", "liked")}
          className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-white/5"
        >
          <Heart className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{t.account.youLiked}</span>
        </button>
      </PopoverClose>
      {/* LIKES EARNED IS A FACT, NOT A DOOR. It totals across all four kinds, so
          there is no one shelf it could open — and a row that looks like the
          four above it but does nothing is worse than a row that plainly reads
          as a number. Its own block, under a rule, is what says so. */}
      <div className="flex items-center gap-2.5 border-t border-line px-4 py-2">
        <Heart className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{t.account.likesEarned}</span>
        <span className="shrink-0 font-mono text-[13px] text-foreground">{n(stats?.likes)}</span>
      </div>
    </div>
  )
}

/**
 * The handle prompt, on first sign-in.
 *
 * A handle is assigned automatically at sign-up, so nothing is broken if this is
 * ignored — but it goes in every scene URL and can only be set once, which is too
 * consequential to leave sitting unlabelled in a menu. Dismissing it is allowed;
 * it reappears next session, and the same field stays in the account menu until
 * the handle is claimed.
 */
export function HandleDialog() {
  const t = useT()
  const { data: session } = useSession()
  const [dismissed, setDismissed] = useState(false)
  // Claimed handles set `usernameChangedAt`, which is also what closes this the
  // moment the save lands — the session refresh flips the condition.
  const unclaimed = !!session?.user.username && !session.user.usernameChangedAt
  return (
    <Dialog open={unclaimed && !dismissed} onOpenChange={(o) => !o && setDismissed(true)}>
      <DialogContent className="w-[24rem] gap-0 border-line-strong bg-surface-raised p-5 sm:max-w-[24rem]">
        <DialogTitle className="text-sm font-medium">{t.account.handleTitle}</DialogTitle>
        <DialogDescription className="mt-1 text-xs leading-snug text-muted-foreground">
          {t.account.handleHint}
        </DialogDescription>
        <p className="mt-1.5 text-xs leading-snug text-amber-200/90">{t.account.handleOnce}</p>
        {session?.user.username && <HandleField current={session.user.username} />}
      </DialogContent>
    </Dialog>
  )
}

/** Claiming the handle. Shown only until it's claimed — after that it's fixed, and
 *  a menu is the wrong place to keep saying so. */
function HandleField({ current }: { current: string }) {
  const t = useT()
  const { refetch } = useSession()
  const [value, setValue] = useState(current)
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle")
  // The suggested handle is a real answer, so confirming it unchanged is allowed —
  // it claims the name and closes the question for good.
  const valid = !!value.trim()

  const save = async () => {
    if (!valid) return
    setState("saving")
    const res = await fetch("/api/username", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: value }),
    })
    if (res.ok) {
      setState("saved")
      // Awaited, and past the cookie cache: the session carries the name shown in
      // the menu and the flag that closes the prompt, so firing this off and
      // forgetting it left both stale until a reload.
      await authClient.getSession({ query: { disableCookieCache: true } })
      await refetch()
      setTimeout(() => setState("idle"), 1500)
      return
    }
    const { error } = (await res.json().catch(() => ({}))) as { error?: string }
    setState(
      error === "taken"
        ? t.account.handleTaken
        : error === "reserved"
          ? t.account.handleReserved
          : error === "already-set"
            ? t.account.handleFixed
            : t.account.handleInvalid,
    )
  }

  const message = state === "saved" ? t.account.handleSaved : state !== "idle" && state !== "saving" ? state : null

  return (
    <div className="mt-3 border-t border-line pt-3 text-left">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setState("idle")
          }}
          maxLength={24}
          spellCheck={false}
          className="h-7 border-line-strong bg-white/5 font-mono text-xs"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!valid || state === "saving"}
          className="h-7 shrink-0 bg-blue-400 px-2 text-xs text-white hover:bg-blue-300 disabled:opacity-40"
        >
          {t.account.handleSave}
        </Button>
      </form>
      {message && (
        <div className={cn("mt-1 text-[11px]", state === "saved" ? "text-blue-400" : "text-red-400")}>{message}</div>
      )}
    </div>
  )
}

/** The four shelves the account can send you to. */
export type LibraryDoor = "grade" | "effect" | "graph" | "scene"

export function AccountButton({
  asHeader = false,
  onOpenLibrary,
  children,
}: {
  asHeader?: boolean
  onOpenLibrary?: (kind: LibraryDoor, facet: "yours" | "liked") => void
  /**
   * The row the button sits in, built around the trigger it is handed. Given,
   * the menu hangs from that whole row with right edges aligned — the way the
   * right dock hangs from the top-right cluster — rather than centred under a
   * 28px avatar, which pushed it past the row's edge.
   */
  children?: (trigger: ReactNode) => ReactNode
}) {
  const t = useT()
  const { data: session } = useSession()
  useEffect(() => {
    if (session && !cached) void fetchMe()
  }, [session])

  const avatar = session?.user.image
  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className={cn("rounded-md hover:bg-white/5 hover:text-foreground", asHeader ? "size-8" : "size-7")}
      aria-label={t.account.label}
    >
      {/* A shade larger than the outline icon — a photo needs more area than a
          line drawing to read at this size, without filling the whole button. */}
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className={cn("rounded-full object-cover", asHeader ? "size-6.5" : "size-5.5")} />
      ) : (
        <CircleUserRound className={asHeader ? "size-5" : "size-4"} />
      )}
    </Button>
  )

  if (!session) {
    return (
      <Dialog>
        {children ? children(<DialogTrigger asChild>{trigger}</DialogTrigger>) : <DialogTrigger asChild>{trigger}</DialogTrigger>}
        <DialogContent
          // Focus returns to the trigger on close otherwise, leaving it ringed.
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="w-[21rem] gap-0 border-line-strong bg-surface-raised p-6 sm:max-w-[21rem]"
        >
          <div className="mb-5 text-center">
            <WandSparkles className="mx-auto size-6 text-blue-400" />
            <DialogTitle className="mt-3 text-base font-semibold">{t.account.signInTitle}</DialogTitle>
            <DialogDescription className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {t.account.signInBlurb}
            </DialogDescription>
          </div>
          <SignInForm />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Popover>
      {children ? (
        <PopoverAnchor asChild>{children(<PopoverTrigger asChild>{trigger}</PopoverTrigger>)}</PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      )}
      <PopoverContent
        side="bottom"
        align={children ? "end" : "center"}
        sideOffset={8}
        // Opening the menu is not a request to rename yourself.
        onOpenAutoFocus={(e) => e.preventDefault()}
        // No backdrop-blur: this floats over the 3D canvas, which is animating
        // exactly while the menu is open. Same reason, same tokens as the
        // dock's own popovers. See AGENTS.md.
        className="w-60 rounded-surface border-line-strong bg-surface-raised p-0 shadow-float"
      >
        <div className="flex items-center gap-2.5 px-3 py-3">
          {session.user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.user.image} alt="" className="size-9 shrink-0 rounded-full" />
          ) : (
            <span className="size-9 shrink-0 rounded-full bg-white/10" />
          )}
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate font-mono text-xs font-medium">{session.user.username ?? session.user.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">{session.user.email}</div>
          </div>
        </div>
        {session.user.username && !session.user.usernameChangedAt && (
          <div className="px-3 pb-3">
            <HandleField current={session.user.username} />
          </div>
        )}
        <Portfolio handle={session.user.username ?? null} onOpenLibrary={onOpenLibrary} />
        <div className="p-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void signOut()}
            className="h-8 w-full gap-1.5 border border-red-500/25 bg-red-500/10 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300"
          >
            <LogOut className="size-3.5" />
            {t.account.signOut}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
