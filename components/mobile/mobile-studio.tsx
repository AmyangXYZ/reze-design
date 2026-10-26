"use client"

// The editor on a phone, lite. The scene is the page, full screen, as the
// view-only phone shell sets it; the account and every tool wait behind one
// mark (☰, in the shell's top row) and opens on a card floating in the middle of the
// screen: white paper, as the computer's dialogs are, the scene around it as
// it was. Inside, as a phone's own settings go: a list, each row going one
// level in, the bar's back going one level out. Each level picks,
// applies or tunes; nothing on a phone is authored (no graphs, no code). A
// computer is where a scene is made in full. Held on its side, a phone only
// plays.

import { useRef, useState, type ComponentType, type ReactNode } from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  Grid3x3,
  Image as ImageIcon,
  Info,
  Palette,
  Plus,
  Search,
  Shirt,
  Sparkles,
  Upload,
  UserRound,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Cover } from "@/components/ui/cover"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ColorRow, SliderRow } from "@/components/scene/scene-sidebar"
import { EffectParams } from "@/components/scene/effect-params"
import type { EffectParamDecl, EffectParamValue } from "reze-engine"
import { SignInDialog } from "@/components/editor/account-panel"
import { UserAvatar } from "@/components/user-avatar"
import { signOut, useSession } from "@/lib/auth-client"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Section = "account" | "cast" | "clips" | "background" | "ground" | "effect" | "materials" | "post" | "export"

/** A file slot: what it holds, and how to fill or empty it. */
export type MobileSlot = { name: string | null; onPick: (file: File) => void; onRemove: () => void }

/** An applied effect's dials: what it declares, what this scene moved, and how
 *  to move or drop them. */
export type EffectTune = {
  decls: EffectParamDecl[]
  values: Record<string, EffectParamValue> | undefined
  onChange: (name: string, value: EffectParamValue | undefined) => void
  onReset: () => void
}

export function MobileStudio({
  open,
  onOpenChange,
  cast,
  onAddModel,
  onReplaceModel,
  onRemoveModel,
  motion,
  camera,
  music,
  background,
  ground,
  effects,
  materials,
  grades,
  exportPane,
  onExportOpen,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  cast: { id: string; name: string }[]
  /** A model from the phone's files: a .zip of its folder, or its .pmx. */
  onAddModel: (files: File[]) => void
  onReplaceModel: (id: string, files: File[]) => void
  onRemoveModel: (id: string) => void
  /** The lead's motion; null with no cast. */
  motion: MobileSlot | null
  camera: MobileSlot
  music: MobileSlot
  background: { color: string; onColor: (hex: string) => void; image: MobileSlot }
  ground: { enabled: boolean; onEnabled: (on: boolean) => void; color: string; onColor: (hex: string) => void }
  effects: {
    items: { id: string; label: string }[]
    applied: (id: string) => boolean
    onToggle: (id: string) => void
    /** An applied effect's dials, when it has any. */
    tune: (id: string) => EffectTune | null
  }
  /** The lead's material groups and the looks a group can wear. */
  materials: {
    groups: { id: string; label: string; look: string }[]
    looks: { name: string; label: string }[]
    onPick: (groupId: string, look: string) => void
  }
  grades: {
    items: { name: string; label: string }[]
    current: string
    onPick: (name: string) => void
    intensity: number
    onIntensity: (v: number) => void
  }
  /** The render panel itself, the computer's own. */
  exportPane: ReactNode
  onExportOpen: (open: boolean) => void
}) {
  const t = useT()
  const { data: session } = useSession()
  const handle = session?.user.username ?? session?.user.name ?? ""
  const [signingIn, setSigningIn] = useState(false)
  // Where in the menu: a section, and in it a group (Materials) or an effect
  // (Effects) one level further in.
  const [section, setSectionState] = useState<Section | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const [effectId, setEffectId] = useState<string | null>(null)
  const setSection = (next: Section | null) => {
    // The render frames the canvas for its shape while its level is open.
    if ((next === "export") !== (section === "export")) onExportOpen(next === "export")
    setSectionState(next)
  }
  const close = () => {
    setGroup(null)
    setEffectId(null)
    setSection(null)
    onOpenChange(false)
  }
  const sections: { id: Section; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { id: "cast", label: t.lab.groups.cast, icon: UserRound },
    { id: "clips", label: t.lab.groups.clips, icon: Clapperboard },
    { id: "background", label: t.lab.rows.background, icon: ImageIcon },
    { id: "ground", label: t.mobile.ground, icon: Grid3x3 },
    { id: "effect", label: t.lab.rows.effect, icon: Sparkles },
    { id: "materials", label: t.lab.rows.materials, icon: Shirt },
    { id: "post", label: t.lab.tabs.grade, icon: Palette },
    { id: "export", label: t.tabs.render, icon: Download },
  ]

  // One picker for every file a phone sends, with no extension filter: iOS
  // greys out a type it does not know (.vmd), and a phone cannot pick a
  // folder, so a model arrives as its folder zipped, or as the .pmx alone.
  const picker = useRef<HTMLInputElement>(null)
  const onFiles = useRef<(files: File[]) => void>(() => {})
  const pick = (then: (files: File[]) => void) => {
    onFiles.current = then
    picker.current?.click()
  }

  const groupRow = materials.groups.find((x) => x.id === group)
  const effectRow = effects.items.find((x) => x.id === effectId)
  const tuning = effectRow ? effects.tune(effectRow.id) : null
  const sectionLabel = section === "account" ? t.account.label : sections.find((s) => s.id === section)?.label
  const deeper = groupRow ?? effectRow
  const title = deeper?.label ?? sectionLabel ?? t.mobile.edit
  // Where the back goes, named as a phone's bar names it.
  const backTo = deeper ? sectionLabel : section ? t.mobile.edit : null
  const back = () => {
    if (group) setGroup(null)
    else if (effectId) setEffectId(null)
    else setSection(null)
  }
  // A level's key, so each slides in as it is entered.
  const level = `${section ?? ""}|${group ?? ""}|${effectId ?? ""}`
  // The long lists (effects, a group's looks, grades) take a search; it
  // belongs to its level and is empty again on the next.
  const searchable = (section === "effect" && !effectRow) || (section === "materials" && !!groupRow) || section === "post"
  const [find, setFind] = useState({ level: "", q: "" })
  const query = find.level === level ? find.q.trim().toLowerCase() : ""
  const found = (label: string) => !query || label.toLowerCase().includes(query)

  const body = (() => {
    switch (section) {
      case null:
        return (
          <>
            {/* Who you are, first, as a phone's settings begin; its own level in. */}
            <Group>
              <Row
                icon={
                  session ? (
                    <UserAvatar name={handle} image={session.user.image} className="size-6 text-2xs" />
                  ) : (
                    <UserRound className="size-3.5 shrink-0" />
                  )
                }
                label={<span className={cn("truncate", session && "font-mono")}>{session ? `@${handle}` : t.account.label}</span>}
                end={<ChevronRight className="size-3.5 shrink-0" />}
                onClick={() => setSection("account")}
              />
            </Group>
            <div className="h-3" />
          <Group>
            {sections.map(({ id, label, icon: Icon }) => (
              <Row
                key={id}
                icon={<Icon className="size-3.5 shrink-0" />}
                label={label}
                end={<ChevronRight className="size-3.5 shrink-0" />}
                onClick={() => setSection(id)}
              />
            ))}
          </Group>
          </>
        )
      case "account":
        return session ? (
          <Group>
            <Row
              icon={<UserAvatar name={handle} image={session.user.image} className="size-8 text-xs" />}
              label={
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono">@{handle}</span>
                  <span className="truncate text-2xs text-muted-foreground">{session.user.email}</span>
                </span>
              }
            />
            {session.user.username && (
              <Row
                label={t.account.profile}
                end={<ChevronRight className="size-3.5 shrink-0" />}
                onClick={() => window.open(`/${session.user.username}`, "_blank", "noopener")}
              />
            )}
            <Row label={t.account.signOut} onClick={() => void signOut()} />
          </Group>
        ) : (
          <Group>
            <Row label={t.account.signIn} end={<ChevronRight className="size-3.5 shrink-0" />} onClick={() => setSigningIn(true)} />
          </Group>
        )
      case "cast":
        return (
          <Group>
            {cast.map((m) => (
              <Row
                key={m.id}
                label={<span className="truncate">{m.name}</span>}
                end={
                  <>
                    <RowIcon label={t.lab.aria.replaceModel(m.name)} onClick={() => pick((f) => onReplaceModel(m.id, f))}>
                      <Upload className="size-3.5" />
                    </RowIcon>
                    <RowIcon label={t.lab.aria.deleteModel(m.name)} onClick={() => onRemoveModel(m.id)} danger>
                      <X className="size-3.5" />
                    </RowIcon>
                  </>
                }
              />
            ))}
            {/* One model on a phone: it is added while there is none, and
                replaced after that. A scene made with more keeps them. */}
            {cast.length === 0 && (
              <Row
                label={
                  <span className="flex items-center gap-2">
                    <Plus className="size-3.5" />
                    {t.lab.addModel}
                  </span>
                }
                end={<span className="font-mono text-2xs text-muted-foreground">{t.mobile.modelFiles}</span>}
                onClick={() => pick(onAddModel)}
              />
            )}
          </Group>
        )
      case "clips":
        return (
          <Group>
            {motion && <SlotRow label={t.mobile.motion} slot={motion} pick={pick} />}
            <SlotRow label={t.lab.rows.camera} slot={camera} pick={pick} />
            <SlotRow label={t.lab.groups.music} slot={music} pick={pick} />
          </Group>
        )
      case "background":
        return (
          <Group>
            <Inset>
              <ColorRow label={t.lab.ctl.color} value={background.color} onChange={background.onColor} />
            </Inset>
            <SlotRow label={t.mobile.picture} slot={background.image} pick={pick} />
          </Group>
        )
      case "ground":
        return (
          <Group>
            <Row label={t.lab.ctl.showGround} end={<Switch size="sm" checked={ground.enabled} onCheckedChange={ground.onEnabled} />} />
            <Inset>
              <ColorRow label={t.lab.ctl.color} value={ground.color} onChange={ground.onColor} />
            </Inset>
          </Group>
        )
      case "effect":
        // One effect's dials, a level in; taken off meanwhile, back to the list.
        if (effectRow)
          return tuning ? (
            <>
              {/* The dials as the menu's rows: one height, a hairline under each. */}
              <div className="flex flex-col [&>div]:mt-0 [&>div]:h-9 [&>div]:border-b [&>div]:border-line">
                <EffectParams decls={tuning.decls} values={tuning.values} onChange={tuning.onChange} />
              </div>
              <Row label={t.lab.ctl.resetParams} onClick={tuning.onReset} />
            </>
          ) : (
            <p className="py-2 text-muted-foreground">—</p>
          )
        return (
          <Group>
            {effects.items.filter((e) => found(e.label)).map((e) => {
              const on = effects.applied(e.id)
              return (
                <div key={e.id} className="flex items-center border-b border-line last:border-b-0">
                  <div className="min-w-0 flex-1 [&>*]:border-b-0">
                    <Row label={<span className="truncate">{e.label}</span>} end={<Tick on={on} />} onClick={() => effects.onToggle(e.id)} />
                  </div>
                  {/* Its dials, a level in, once it is on and has any. */}
                  {on && effects.tune(e.id) && (
                    <RowIcon label={e.label} onClick={() => setEffectId(e.id)}>
                      <ChevronRight className="size-3.5" />
                    </RowIcon>
                  )}
                </div>
              )
            })}
          </Group>
        )
      case "materials":
        if (!groupRow)
          return materials.groups.length === 0 ? (
            <p className="px-1 py-2 text-muted-foreground">—</p>
          ) : (
            <Group>
              {materials.groups.map((x) => (
                <Row
                  key={x.id}
                  label={<span className="truncate">{x.label}</span>}
                  end={
                    <>
                      <span className="max-w-[45%] truncate font-mono text-2xs text-muted-foreground">{x.look}</span>
                      <ChevronRight className="size-3.5 shrink-0" />
                    </>
                  }
                  onClick={() => setGroup(x.id)}
                />
              ))}
            </Group>
          )
        return (
          <Group>
            {materials.looks.filter((l) => found(l.label)).map((l) => (
              <Row key={l.name} label={<span className="truncate">{l.label}</span>} end={<Tick on={l.label === groupRow.look} />} onClick={() => materials.onPick(groupRow.id, l.name)} />
            ))}
          </Group>
        )
      case "post":
        return (
          <>
            {/* How strongly the grade is laid on, its own group above the grades. */}
            <Group>
              <Inset>
                <SliderRow label={t.mobile.strength} value={grades.intensity} min={0} max={1} step={0.01} onChange={grades.onIntensity} fmt={(v) => v.toFixed(2)} />
              </Inset>
            </Group>
            <div className="h-2" />
            <Group>
              {grades.items.filter((g) => found(g.label)).map((g) => (
                <Row key={g.name} label={<span className="truncate">{g.label}</span>} end={<Tick on={g.name === grades.current} />} onClick={() => grades.onPick(g.name)} />
              ))}
            </Group>
          </>
        )
      case "export":
        return <div className="px-1">{exportPane}</div>
    }
  })()

  return (
    <>
      {open && (
        <>
          {/* The scene behind the card, untouched; tapped, it lets the card go. */}
          <div data-keep aria-hidden className="absolute inset-0 z-20" onClick={close} />
          <div data-keep className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
            <div
              data-paper="light"
              data-paper-at="pop"
              className="pointer-events-auto flex h-[min(34rem,70dvh)] w-[min(26rem,92vw)] animate-[paper-settle_var(--default-transition-duration)_cubic-bezier(0.32,0.72,0,1)] flex-col overflow-hidden border bg-surface text-xs text-foreground"
            >
              {/* The bar: back, named for where it goes; the title; away. */}
              <div className="grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-line px-1.5">
                {backTo ? (
                  <Button
                    variant="bare"
                    onClick={back}
                    className="flex h-7 min-w-0 items-center gap-0.5 justify-self-start pr-1.5 text-xs"
                  >
                    <ChevronLeft className="size-3.5 shrink-0" />
                    <span className="truncate">{backTo}</span>
                  </Button>
                ) : (
                  <span />
                )}
                <span className="max-w-[10rem] truncate text-center text-sm font-medium">{title}</span>
                <Button
                  variant="bare"
                  aria-label={t.library.close}
                  onClick={close}
                  className="flex size-7 items-center justify-center justify-self-end"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              {/* Only the level scrolls; each slides in as it is entered. */}
              <Cover>
                {searchable && (
                  <label className="mx-3 flex h-9 shrink-0 items-center gap-2 border-b border-line">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <Input
                      variant="bare"
                      type="search"
                      value={find.level === level ? find.q : ""}
                      onChange={(e) => setFind({ level, q: e.target.value })}
                      placeholder={t.rail.search}
                      className="h-full min-w-0 flex-1 bg-transparent text-xs"
                    />
                  </label>
                )}
                <div
                  key={level}
                  className="no-scrollbar min-h-0 flex-1 animate-[ios-push_var(--default-transition-duration)_cubic-bezier(0.32,0.72,0,1)] overflow-y-auto px-3 py-1"
                >
                  {body}
                </div>
              </Cover>
              {/* Said plainly, at the foot of the first level: this is the lite
                  version, and the whole editor is on a computer. A sentence
                  a line, so a break never falls mid-sentence. */}
              {!section && (
              <p className="shrink-0 border-t border-line px-5 py-4 text-center text-sm leading-relaxed font-normal text-balance text-foreground">
                <span className="block">
                  <Info className="mr-1.5 inline size-4 -translate-y-px align-middle" />
                  {t.mobile.lite.what}
                </span>
                <span className="block">
                  {t.mobile.lite.before}
                  <a href="https://reze.design" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    reze.design
                  </a>
                  {t.mobile.lite.after}
                </span>
              </p>
              )}
            </div>
          </div>
        </>
      )}
      <SignInDialog open={signingIn && !session} onOpenChange={setSigningIn} title={t.account.signInTitle} blurb={t.account.signInBlurb} />
      <input
        ref={picker}
        type="file"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          // Cleared so picking the same file again still fires.
          e.target.value = ""
          if (files.length) onFiles.current(files)
        }}
      />
    </>
  )
}

/** A run of rows: the list, set on the paper as the computer's lists are. */
function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>
}

/** A control that brings its own row (a colour, a slider), padded as a row. */
function Inset({ children }: { children: ReactNode }) {
  return <div className="border-b border-line py-2 last:border-b-0">{children}</div>
}

/** A row of the list: an icon, its words, what can be done at its end;
 *  tapped, it acts or goes one level in. */
function Row({ icon, label, end, onClick }: { icon?: ReactNode; label: ReactNode; end?: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 items-center gap-2">{label}</span>
      {end}
    </>
  )
  const box = "flex h-9 w-full items-center gap-2.5 border-b border-line text-left text-xs last:border-b-0"
  return onClick ? (
    <Button variant="bare" onClick={onClick} className={box}>
      {inner}
    </Button>
  ) : (
    <div className={box}>{inner}</div>
  )
}

function RowIcon({
  label,
  onClick,
  danger,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button
      variant="bare"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("flex size-7 shrink-0 items-center justify-center", danger && "hover:text-red-400")}
    >
      {children}
    </Button>
  )
}

/** A file slot's row: what it holds, a file in its place, and emptied. */
function SlotRow({ label, slot, pick }: { label: string; slot: MobileSlot; pick: (then: (files: File[]) => void) => void }) {
  return (
    <Row
      label={
        <>
          <span className="w-12 shrink-0">{label}</span>
          <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">{slot.name ?? "—"}</span>
        </>
      }
      end={
        <>
          <RowIcon label={label} onClick={() => pick((f) => f[0] && slot.onPick(f[0]))}>
            <Upload className="size-3.5" />
          </RowIcon>
          {/* Always in its place, greyed when there is nothing to take out, so
              the actions stand in one column down the list. */}
          <RowIcon label={label} onClick={slot.onRemove} danger disabled={!slot.name}>
            <X className="size-3.5" />
          </RowIcon>
        </>
      }
    />
  )
}

/** The chosen row's mark, in the selected blue, as a phone checks a choice. */
function Tick({ on }: { on: boolean }) {
  return <Check className={cn("size-3.5 shrink-0 text-blue-400", !on && "invisible")} />
}
