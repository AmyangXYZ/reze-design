"use client"

// Which model the AI uses, and with whose key: the gear in the AI panel's
// header (lib/ai/connections holds the settings). A service, its key, the
// models wanted from it, and the one in use. Every model is verified when
// it is added (one tiny request: does the key work, does it see a picture,
// does it call a tool), so the list never offers one that cannot do the job
// without saying so.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ArrowLeft, Check, ExternalLink, Plus, RotateCw, Settings, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AstroidSpinner } from "@/components/editor/astroid-spinner"
import { cn } from "@/lib/utils"
import { PRESETS, presetOf, type ProviderId } from "@/lib/ai/providers/presets"
import { connectionLabel, listModels, updateAi, verifyModel, type Active, type AiSettings, type Connection, type ModelEntry } from "@/lib/ai/connections"

export type AgentSettingsText = {
  menu: string
  premium: string
  addConnection: string
  addModel: string
  key: string
  baseURL: string
  getKey: string
  continue: string
  remove: string
  removeModel: string
  verify: string
  search: string
  loading: string
  none: string
  recommended: string
  searchAll: (n: number) => string
  useModel: (id: string) => string
  checking: string
  verdicts: { textOnly: string; noVision: string; noTools: string; error: string }
  keyNote: string
}

const isActive = (a: Active | null, connection: string, model?: string) => !!a && a.connection === connection && (model === undefined || ("model" in a && a.model === model))

/**
 * One choosable line: a mark column (the selection check, or the row's own
 * icon), the label, a trailing note or controls. Every view is built from
 * these, so labels share one left edge whatever the row does.
 */
function Line({
  selected,
  mark,
  onClick,
  children,
  trailing,
  className,
}: {
  selected?: boolean
  mark?: ReactNode
  onClick?: () => void
  children: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("group flex items-center gap-1 rounded-chip pr-1 hover:bg-white/5", className)}>
      <Button
        variant="ghost"
        onClick={onClick}
        disabled={!onClick}
        className="h-7 min-w-0 flex-1 justify-start gap-2 rounded-chip px-2 text-xs font-normal text-foreground hover:bg-transparent disabled:opacity-100"
      >
        <span className="flex w-3 shrink-0 justify-center">{selected ? <Check className="size-3 text-blue-400" /> : mark}</span>
        <span className="min-w-0 truncate">{children}</span>
      </Button>
      {trailing}
    </div>
  )
}

function Verdict({ entry, text }: { entry: ModelEntry; text: AgentSettingsText }) {
  if (entry.verdict === "checking") return <AstroidSpinner className="size-3 shrink-0 text-muted-foreground" />
  if (entry.verdict === "ready") return null
  // Text only still works — a note, not a warning.
  return <span className={cn("shrink-0 text-2xs", entry.verdict === "textOnly" ? "text-muted-foreground" : "text-amber-400")}>{text.verdicts[entry.verdict]}</span>
}

const iconButton = "size-5 shrink-0 rounded-chip text-muted-foreground hover:bg-white/10 hover:text-foreground"

/** A field in the menu: a row's height, its text on the labels' left edge. */
const FIELD = "h-7 rounded-chip px-2 text-xs md:text-xs"

type View = { kind: "list" } | { kind: "add" } | { kind: "models"; connection: string }

/** The gear in the panel header: services, keys and models. */
export function AgentMenu({
  settings,
  active,
  premium,
  open,
  onOpenChange,
  text,
}: {
  settings: AiSettings
  active: Active | null
  premium: boolean
  /** Controlled, so the panel's "Add a model" can open it too. */
  open: boolean
  onOpenChange: (open: boolean) => void
  text: AgentSettingsText
}) {
  // The content mounts on open, so every open starts on the list.
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={text.menu} className="size-5 shrink-0 rounded-chip text-muted-foreground hover:bg-white/10 hover:text-foreground">
          <Settings className="size-3.5" />
        </Button>
      </PopoverTrigger>
      {/* The left dock's popovers, to the pixel: radius, surface, edge, shadow. */}
      <PopoverContent align="end" className="w-64 rounded-surface border-line-strong bg-surface-raised p-2 shadow-float" onCloseAutoFocus={(e) => e.preventDefault()}>
        <MenuBody settings={settings} active={active} premium={premium} text={text} />
      </PopoverContent>
    </Popover>
  )
}

function MenuBody({ settings, active, premium, text }: { settings: AiSettings; active: Active | null; premium: boolean; text: AgentSettingsText }) {
  const [view, setView] = useState<View>({ kind: "list" })
  if (view.kind === "add") return <AddConnection text={text} onBack={() => setView({ kind: "list" })} onAdded={(id) => setView({ kind: "models", connection: id })} />
  if (view.kind === "models") {
    const c = settings.connections.find((x) => x.id === view.connection)
    if (c) return <AddModel connection={c} text={text} onBack={() => setView({ kind: "list" })} />
  }

  const choose = (a: Active) => updateAi((s) => ({ ...s, active: a }))
  const removeModel = (c: Connection, model: string) =>
    updateAi((s) => ({
      ...s,
      connections: s.connections.map((x) => (x.id === c.id ? { ...x, models: x.models.filter((m) => m.id !== model) } : x)),
    }))
  const removeConnection = (c: Connection) =>
    updateAi((s) => ({
      ...s,
      connections: s.connections.filter((x) => x.id !== c.id),
    }))

  return (
    <div className="max-h-[28rem] overflow-y-auto">
      {premium && (
        <Line selected={isActive(active, "premium")} onClick={() => choose({ connection: "premium" })}>
          {text.premium}
        </Line>
      )}
      {settings.connections.map((c) => (
        <div key={c.id} className="mt-1 border-t border-line pt-1 first:mt-0 first:border-0 first:pt-0">
          <div className="flex items-center gap-1 pr-1">
            <p className="min-w-0 flex-1 truncate px-2 py-1 text-2xs text-muted-foreground">{connectionLabel(c)}</p>
            <Button variant="ghost" size="icon" aria-label={text.remove} tooltip={text.remove} onClick={() => removeConnection(c)} className={cn(iconButton, "hover:text-red-400")}>
              <Trash2 className="size-3" />
            </Button>
          </div>
          {c.models.map((m) => (
            <div key={m.id}>
              <Line
                selected={isActive(active, c.id, m.id)}
                onClick={() => choose({ connection: c.id, model: m.id })}
                trailing={
                  <>
                    <Verdict entry={m} text={text} />
                    {m.verdict !== "checking" && m.verdict !== "ready" && m.verdict !== "textOnly" && (
                      <Button variant="ghost" size="icon" aria-label={text.verify} tooltip={text.verify} onClick={() => void verifyModel(c.id, m.id)} className={iconButton}>
                        <RotateCw className="size-3" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={text.removeModel}
                      tooltip={text.removeModel}
                      onClick={() => removeModel(c, m.id)}
                      className={cn(iconButton, "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                    >
                      <X className="size-3" />
                    </Button>
                  </>
                }
              >
                {m.id}
              </Line>
              {/* What the service said, word for word — copyable, the way to debug it. */}
              {m.error && m.verdict !== "ready" && m.verdict !== "checking" && m.verdict !== "textOnly" && (
                <p className="line-clamp-3 pr-2 pb-1 pl-7 text-2xs break-words text-amber-400 select-text">{m.error}</p>
              )}
            </div>
          ))}
          <Line mark={<Plus className="size-3 text-muted-foreground" />} onClick={() => setView({ kind: "models", connection: c.id })}>
            <span className="text-muted-foreground">{text.addModel}</span>
          </Line>
        </div>
      ))}
      <div className={cn(settings.connections.length || premium ? "mt-1 border-t border-line pt-1" : "")}>
        <Line mark={<Plus className="size-3" />} onClick={() => setView({ kind: "add" })}>
          {text.addConnection}
        </Line>
      </div>
      <p className="px-2 pt-1 pb-1.5 text-2xs leading-4 text-muted-foreground">{text.keyNote}</p>
    </div>
  )
}

/** A sub-view's title, which is also the way back. */
function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-1 border-b border-line pb-1">
      <Line mark={<ArrowLeft className="size-3 text-muted-foreground" />} onClick={onBack}>
        <span className="font-medium">{title}</span>
      </Line>
    </div>
  )
}

function AddConnection({ text, onBack, onAdded }: { text: AgentSettingsText; onBack: () => void; onAdded: (id: string) => void }) {
  const [provider, setProvider] = useState<ProviderId | null>(null)
  const [key, setKey] = useState("")
  const [baseURL, setBaseURL] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preset = provider ? presetOf(provider) : undefined
  const ready = provider && key.trim() && (provider !== "custom" || baseURL.trim())

  const submit = async () => {
    if (!ready || !provider || busy) return
    setBusy(true)
    setError(null)
    const via = {
      provider,
      key: key.trim(),
      ...(provider === "custom" ? { baseURL: baseURL.trim() } : {}),
    }
    try {
      // Listing the models is the cheapest proof the key works.
      await listModels(via)
      const id = crypto.randomUUID()
      updateAi((s) => ({
        ...s,
        connections: [...s.connections, { id, ...via, models: [] }],
      }))
      onAdded(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="pb-1">
      <Header title={text.addConnection} onBack={onBack} />
      <div className="grid grid-cols-3 gap-1">
        {PRESETS.map((p) => (
          <Button
            key={p.id}
            variant="ghost"
            onClick={() => setProvider(p.id)}
            className={cn(
              "h-7 rounded-chip border px-2 text-xs font-normal",
              p.id === provider ? "border-blue-400 text-foreground" : "border-line text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div className="mt-1.5 space-y-1.5">
        {provider === "custom" && <Input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder={text.baseURL} className={FIELD} />}
        <Input
          // Masked as text, not a password field: a browser offers to save
          // whatever is typed into one, and a key is not a site password.
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
            e.stopPropagation()
          }}
          placeholder={text.key}
          className={cn(FIELD, "font-mono [-webkit-text-security:disc]")}
        />
        {error && <p className="line-clamp-3 px-2 text-2xs break-words text-amber-400 select-text">{error}</p>}
        {/* The link and the button on one 28px line, the link's text on the
            fields' left edge. */}
        <div className="flex items-center gap-2">
          {/* Always there, so the row does not shift; inert until a service with
              a key page is picked. */}
          <a
            href={preset?.keyUrl || undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!preset?.keyUrl}
            className="inline-flex h-7 items-center gap-1 rounded-chip px-2 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            {text.getKey}
            <ExternalLink className="size-3" />
          </a>
          <Button size="xs" onClick={() => void submit()} disabled={!ready || busy} className="ml-auto h-7 min-w-16 rounded-chip px-3 text-xs">
            {busy ? <AstroidSpinner className="size-3" /> : text.continue}
          </Button>
        </div>
      </div>
    </div>
  )
}

function AddModel({ connection, text, onBack }: { connection: Connection; text: AgentSettingsText; onBack: () => void }) {
  const [models, setModels] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const { provider, key, baseURL } = connection
  useEffect(() => {
    listModels({ provider, key, ...(baseURL ? { baseURL } : {}) })
      .then(setModels)
      .catch((e: Error) => setError(e.message))
  }, [provider, key, baseURL])
  const have = new Set(connection.models.map((m) => m.id))
  const q = query.trim()
  // Opened, the list is short: the service's recommended models it actually
  // has, and the ones already added. Typing searches everything.
  const shown = useMemo(() => {
    if (!models) return []
    if (q) return models.filter((m) => m.toLowerCase().includes(q.toLowerCase())).slice(0, 200)
    const listed = new Set(models)
    const recommended = (presetOf(connection.provider)?.recommended ?? []).filter((m) => listed.has(m))
    return [...new Set([...recommended, ...connection.models.map((m) => m.id)])]
  }, [models, q, connection.provider, connection.models])
  // An exact id the list does not show — a model the service has not listed yet.
  const custom = q && models && !models.includes(q) ? q : null

  const add = (model: string) => {
    if (!have.has(model)) void verifyModel(connection.id, model)
    updateAi((s) => ({ ...s, active: { connection: connection.id, model } }))
    onBack()
  }

  return (
    <div className="pb-1">
      <Header title={connectionLabel(connection)} onBack={onBack} />
      <div className="pb-1">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const first = shown[0] ?? custom
            if (e.key === "Enter" && first) add(first)
            e.stopPropagation()
          }}
          placeholder={text.search}
          className={FIELD}
        />
      </div>
      <div className="max-h-72 overflow-y-auto">
        {error ? (
          <p className="px-2 py-1 text-2xs break-words text-amber-400 select-text">{error}</p>
        ) : models === null ? (
          <p className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
            <AstroidSpinner className="size-3" />
            {text.loading}
          </p>
        ) : (
          <>
            {!q && shown.length > 0 && <p className="px-2 pt-1 pb-0.5 text-2xs text-muted-foreground">{text.recommended}</p>}
            {shown.map((m) => (
              <Line key={m} selected={have.has(m)} onClick={() => add(m)}>
                {m}
              </Line>
            ))}
            {custom && (
              <Line onClick={() => add(custom)}>
                <span className="text-muted-foreground">{text.useModel(custom)}</span>
              </Line>
            )}
            {q && !shown.length && !custom && <p className="px-2 py-1 text-xs text-muted-foreground">{text.none}</p>}
            {!q && <p className="px-2 pt-1 pb-0.5 text-2xs text-muted-foreground">{text.searchAll(models.length)}</p>}
          </>
        )}
      </div>
    </div>
  )
}
