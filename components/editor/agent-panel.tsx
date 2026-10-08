"use client"

// The AI panel's body: the conversation, what it is doing now, and the box to
// ask in.
//
// Read like a coding agent's transcript, not a chat log. Each step the AI
// took is a line saying what it did, with what it found beneath it ("Looked
// at 2 views" / "reze: face +0.8 stops · 89% in sun"); its reasoning between
// steps is a dim note you can open; and while it works, a status line says
// what it is doing now, for how long, and how many steps in — so a run that
// takes a minute reads as a minute of visible work, not a frozen box. The
// canvas changes beside it; the panel has no scrim for that reason.

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Square, ArrowUp, ImagePlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { prepareReference, type ReferenceImage } from "@/lib/ai/reference-image"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { AstroidSpinner } from "@/components/editor/astroid-spinner"
import { cn } from "@/lib/utils"
import { LOOP_NOTE, type AgentMessage, type Usage } from "@/lib/ai/agent-loop"
import { THINKING_VERBS, doingOf, formatTokens, summarizeStep, usageParts, type StepSummary } from "@/lib/ai/agent-summary"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AgentLive, AgentRun } from "@/hooks/use-agent"
import type { Notice, NoticeKind } from "@/lib/ai/agent-notice"

export type AgentPanelText = {
  empty: string
  send: string
  stop: string
  thinking: string
  attach: string
  removeImage: string
  notices: Record<NoticeKind, string>
  kept: string
  retry: string
  continue: string
  newChat: string
  setup: string
  usage: { tokens: (total: string) => string; detail: (input: string, cached: string | null, output: string) => string; none: string }
}

type Line =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "reply"; text: string }
  | { kind: "note"; text: string }
  | { kind: "step"; summary: StepSummary; done: boolean }

/** A tool result's data, back out of the JSON the model was handed. */
function resultData(block: { content?: unknown }): unknown {
  const content = Array.isArray(block.content) ? block.content : []
  const text = content.find((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text")
  if (!text) return typeof block.content === "string" ? { error: block.content } : null
  try {
    return JSON.parse(text.text)
  } catch {
    return null
  }
}

/** The history as the person reads it. `thumbs` are the pictures attached to
 *  a request, by its message index. */
function linesOf(messages: AgentMessage[], thumbs: Record<number, string[]>): Line[] {
  const results = new Map<string, unknown>()
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue
    for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, resultData(b))
  }
  const out: Line[] = []
  for (const [mi, m] of messages.entries()) {
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content
    for (const b of blocks) {
      if (b.type === "text" && m.role === "user") {
        // The loop's own wrap-up note rides in a user turn; it is not theirs.
        if (blocks.some((x) => x.type === "tool_result")) continue
        // Nor are a reference image's measurements, or the loop's own notes
        // (the scene it attached, a nudge to look): those are for the model.
        if (b.text.startsWith("Reference image") || b.text.startsWith(LOOP_NOTE)) {
          // A nudge to look again sends the model back to work after it had
          // already answered; the answer it gives after looking replaces that
          // one, so the first is dropped rather than shown twice.
          if (blocks.length === 1) while (out.length && out[out.length - 1].kind === "reply") out.pop()
          continue
        }
        out.push({ kind: "user", text: b.text, images: thumbs[mi] })
      } else if (b.type === "text" && b.text.trim()) out.push({ kind: "reply", text: b.text })
      else if (b.type === "thinking" && b.thinking.trim()) out.push({ kind: "note", text: b.thinking.trim() })
      else if (b.type === "tool_use") {
        const done = results.has(b.id)
        const input = (b.input ?? {}) as Record<string, unknown>
        out.push({ kind: "step", done, summary: done ? summarizeStep(b.name, input, results.get(b.id)) : { title: doingOf(b.name) ?? b.name } })
      }
    }
  }
  return out
}

/** "1m 04s" / "12s". */
const elapsed = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`
}

/**
 * Every line of the transcript stands on the same grid: a 14px column for its
 * mark, then its text, all at the panel's one size (text-xs) and line height.
 * What tells a request from a step from a note is the mark and the two text
 * colours — never a second type size, never italics.
 */
function Row({ mark, children, className }: { mark?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-1.5", className)}>
      <span className="flex h-[18px] w-3 shrink-0 items-center justify-center">{mark}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** The prompt mark, as Claude Code draws it: ❯ — on a sent request and on
 *  the line you type into, so the two read as the same thing. */
function Prompt() {
  return <span className="text-xs leading-5 text-muted-foreground select-none">❯</span>
}

function Step({ summary, running }: { summary: StepSummary; running: boolean }) {
  return (
    <Row
      mark={
        running ? (
          <AstroidSpinner className="size-3 text-foreground" />
        ) : (
          <span className={cn("size-1.5 rounded-full", summary.failed ? "bg-amber-400" : "bg-muted-foreground")} />
        )
      }
    >
      <div className="truncate">{summary.title}</div>
      {summary.detail && (
        <div className={cn("break-words whitespace-pre-wrap", summary.failed ? "text-amber-400" : "text-muted-foreground")}>{summary.detail}</div>
      )}
    </Row>
  )
}

/** Inline markdown: **bold**, *italic*, `code`. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\*([^*\s][^*]*?)\*/g
  let at = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push(text.slice(at, m.index))
    if (m[1]) out.push(<strong key={m.index} className="font-semibold">{m[1]}</strong>)
    else if (m[2]) out.push(<code key={m.index} className="rounded-chip border border-line px-1 font-mono text-[11px]">{m[2]}</code>)
    else out.push(<em key={m.index}>{m[3]}</em>)
    at = m.index + m[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

/**
 * A reply's markdown, the part of it a model writes in a short answer:
 * paragraphs, headings (shown as bold lines — a narrow panel has no room for
 * a type scale), bullet and numbered lists, and the inline marks above.
 */
function Reply({ text }: { text: string }) {
  type Block = { kind: "p"; text: string } | { kind: "h"; text: string } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] }
  const blocks: Block[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    const last = blocks[blocks.length - 1]
    if (ul || ol) {
      const kind = ul ? "ul" : "ol"
      const item = (ul ?? ol)![1]
      if (last && last.kind === kind) last.items.push(item)
      else blocks.push({ kind, items: [item] })
    } else if (h) blocks.push({ kind: "h", text: h[1] })
    else if (!line.trim()) blocks.push({ kind: "p", text: "" })
    else if (last && last.kind === "p" && last.text) last.text += ` ${line.trim()}`
    else blocks.push({ kind: "p", text: line.trim() })
  }
  return (
    <div className="space-y-1.5">
      {blocks.map((b, i) =>
        b.kind === "ul" || b.kind === "ol" ? (
          <ul key={i} className="space-y-0.5">
            {b.items.map((item, k) => (
              <li key={k} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground tabular-nums">{b.kind === "ul" ? "–" : `${k + 1}.`}</span>
                <span className="min-w-0">{inline(item)}</span>
              </li>
            ))}
          </ul>
        ) : b.kind === "h" ? (
          <p key={i} className="font-semibold">
            {inline(b.text)}
          </p>
        ) : b.text ? (
          <p key={i}>{inline(b.text)}</p>
        ) : null,
      )}
    </div>
  )
}

/** Its reasoning between steps: muted, two lines until opened. */
function Note({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    // Reasoning belongs to what follows it: a little closer than other lines.
    <Collapsible open={open} onOpenChange={setOpen} className="-mb-0.5">
      <Row mark={<AstroidSpinner still className="size-3 text-muted-foreground" />}>
        <CollapsibleTrigger className="w-full cursor-pointer text-left text-muted-foreground hover:text-foreground data-[state=open]:hidden">
          <span className="line-clamp-2 whitespace-pre-wrap">{inline(text)}</span>
        </CollapsibleTrigger>
        {/* Opened, a click folds it back — unless that click ended a text
            selection, which is someone copying the reasoning. */}
        <CollapsibleContent
          className="cursor-pointer whitespace-pre-wrap text-muted-foreground"
          onClick={() => {
            if (!window.getSelection()?.toString()) setOpen(false)
          }}
        >
          {inline(text)}
        </CollapsibleContent>
      </Row>
    </Collapsible>
  )
}

export function AgentPanel({
  messages,
  thumbs,
  live,
  busy,
  locked,
  onSetup,
  run,
  notice,
  lastRun,
  onRetry,
  onNewChat,
  onSend,
  onStop,
  text,
}: {
  messages: AgentMessage[]
  thumbs: Record<number, string[]>
  live: AgentLive
  busy: boolean
  /** A request is running in another tab: one at a time, so sending waits. */
  locked?: boolean
  /** No model to ask yet: the input is off, and this opens the place to add one. */
  onSetup?: () => void
  run: AgentRun | null
  /** How the last run ended, when it did not simply finish. */
  notice: Notice | null
  /** The last request's tokens: undefined before any, null where the service
   *  did not report them. Shown, never sent anywhere. */
  lastRun?: Usage | null
  onRetry: () => void
  onNewChat: () => void
  onSend: (text: string, refs: ReferenceImage[]) => void
  onStop: () => void
  text: AgentPanelText
}) {
  const [draft, setDraft] = useState("")
  const [refs, setRefs] = useState<ReferenceImage[]>([])
  // Pictures still being prepared (resized and measured): each holds a
  // placeholder where its thumbnail will land, and sending waits for them.
  const [preparing, setPreparing] = useState(0)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [now, setNow] = useState(() => Date.now())
  const scroller = useRef<HTMLDivElement>(null)
  const lines = linesOf(messages, thumbs)

  // Up to four pictures a request, from the button, a paste or a drop.
  const attach = async (files: Iterable<File>) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"))
    if (!images.length) return
    const batch = images.slice(0, 4)
    setPreparing((n) => n + batch.length)
    const prepared = await Promise.all(batch.map((f) => prepareReference(f).catch(() => null)))
    setPreparing((n) => n - batch.length)
    setRefs((r) => [...r, ...prepared.filter((x): x is ReferenceImage => x !== null)].slice(0, 4))
  }

  // The clock on the status line, while a run is going.
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [busy])

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length, live.text, live.tool, live.thinking])

  const submit = () => {
    if (busy || locked || onSetup || preparing || (!draft.trim() && !refs.length)) return
    onSend(draft, refs)
    setDraft("")
    setRefs([])
  }

  // What the status line says: the tool at work, else writing, else a
  // thinking word that changes every few seconds so a long think moves.
  const since = run ? Math.max(0, now - run.startedAt) : 0
  const verb = live.retrying ? "Reconnecting" : (doingOf(live.tool) ?? (live.text ? "Writing" : THINKING_VERBS[Math.floor(since / 4000) % THINKING_VERBS.length]))
  // The latest line of reasoning, while it is still forming.
  const thought = live.thinking.trim().split("\n").filter(Boolean).pop() ?? ""

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", dragging && "after:pointer-events-none after:absolute after:inset-1 after:rounded-interior after:border after:border-dashed after:border-blue-400")}
      onDragOver={(e) => {
        if (![...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void attach(e.dataTransfer.files)
      }}
    >
      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pt-0 pb-5 leading-[18px] select-text">
        {lines.length === 0 && !busy && <p className="text-muted-foreground">{text.empty}</p>}
        {lines.map((l, i) =>
          l.kind === "user" ? (
            // A request opens a turn: on its own tinted bar, the way a coding
            // agent sets the prompt apart from the work it set off — the
            // prompt mark, their words in the stronger weight.
            <Row
              key={i}
              mark={<Prompt />}
              className={cn("-mx-1.5 rounded-interior bg-white/[0.06] px-1.5 py-1", i > 0 && "mt-4")}
            >
              {l.images?.length ? (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {l.images.map((src, k) => (
                    // eslint-disable-next-line @next/next/no-img-element -- a local data URL, nothing to optimise
                    <img key={k} src={src} alt="" className="h-14 max-w-full rounded-chip border border-line object-cover" />
                  ))}
                </div>
              ) : null}
              <div className="font-medium whitespace-pre-wrap">{l.text}</div>
            </Row>
          ) : l.kind === "reply" ? (
            <Row key={i} mark={<span className="size-1.5 rounded-full bg-foreground" />}>
              <Reply text={l.text} />
            </Row>
          ) : l.kind === "note" ? (
            <Note key={i} text={l.text} />
          ) : (
            <Step key={i} summary={l.summary} running={busy && !l.done} />
          ),
        )}
        {busy && live.text && (
          <Row>
            <Reply text={live.text} />
          </Row>
        )}
        {busy && (
          // The one live line: what it is doing, for how long, how far in —
          // and, while it thinks, the thought forming beneath.
          <Row mark={<AstroidSpinner className="size-3.5 text-foreground" />}>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="animate-[text-shimmer_2.2s_linear_infinite] truncate bg-[linear-gradient(90deg,var(--color-muted-foreground)_35%,var(--color-foreground)_50%,var(--color-muted-foreground)_65%)] bg-[length:200%_100%] bg-clip-text text-transparent">
                {verb}…
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {elapsed(since)}
                {run && run.steps > 0 ? ` · ${run.steps} ${run.steps === 1 ? "step" : "steps"}` : ""}
              </span>
            </div>
            {thought && !live.tool && !live.text && <p className="line-clamp-2 text-muted-foreground">{thought}</p>}
          </Row>
        )}
        {!busy && notice && !onSetup && (
          // How it ended, in words, and the one thing that helps. A fault is
          // amber; a stop the person (or the step limit) chose is not.
          <Row
            mark={
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  ["stopped", "stoppedScene", "limit"].includes(notice.kind) ? "bg-muted-foreground" : "bg-amber-400",
                )}
              />
            }
          >
            <p className={["stopped", "stoppedScene", "limit"].includes(notice.kind) ? "text-muted-foreground" : "text-amber-400"}>{text.notices[notice.kind]}</p>
            {notice.kept && <p className="text-muted-foreground">{text.kept}</p>}
            {notice.detail && <p className="line-clamp-2 break-words text-muted-foreground">{notice.detail}</p>}
            {notice.action && (
              <Button
                size="xs"
                variant="ghost"
                onClick={notice.action === "newChat" ? onNewChat : onRetry}
                className="mt-1.5 h-6 rounded-chip border border-line-strong px-2 text-xs text-foreground hover:bg-white/5"
              >
                {notice.action === "retry" ? text.retry : notice.action === "continue" ? text.continue : text.newChat}
              </Button>
            )}
          </Row>
        )}
      </div>
      {/* The prompt: a command line on the same tinted bar a sent request
          sits on, so what you type and what you sent look like one thing.
          Attached pictures ride above the line; the picture button, send and
          stop are small marks at its end. Enter sends, Shift+Enter breaks. */}
      {/* Before there is any model to ask: what to do and the button that does
          it, right above the input it unlocks. */}
      {onSetup && (
        // An empty conversation: in the middle of the panel. One with history:
        // just above the input, clear of the messages.
        <div className={cn("flex justify-center", lines.length === 0 ? "pointer-events-none absolute inset-0 items-center pb-12 [&>*]:pointer-events-auto" : "shrink-0 px-4 pb-2")}>
          <Button size="xs" onClick={onSetup} className="h-7 w-fit rounded-chip px-3 text-xs font-medium">
            {text.setup}
          </Button>
        </div>
      )}
      {/* The request's tokens, in one place: live while it runs, the final
          count after — a line of its own above the input, so the chat ends
          above it rather than running underneath. */}
      {lastRun !== undefined && (
        <div className="flex shrink-0 items-end justify-end px-4 pb-1 text-[11px] leading-4 text-muted-foreground tabular-nums">
          {lastRun ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{text.usage.tokens(formatTokens(lastRun.input + lastRun.output))}</span>
              </TooltipTrigger>
              <TooltipContent className="tabular-nums">{text.usage.detail(...usageParts(lastRun))}</TooltipContent>
            </Tooltip>
          ) : (
            text.usage.none
          )}
        </div>
      )}
      <div className="shrink-0 border-t border-line px-2.5 py-1.5">
        <div className="rounded-interior bg-white/[0.06] px-1.5 py-1 ring-blue-400 focus-within:ring-1">
          {(refs.length > 0 || preparing > 0) && (
            <div className="mb-1.5 flex flex-wrap gap-1.5 pl-[18px]">
              {refs.map((r, k) => (
                <div key={k} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL, nothing to optimise */}
                  <img src={r.dataUrl} alt="" className="h-10 rounded-chip border border-line object-cover" />
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={text.removeImage}
                    onClick={() => setRefs((list) => list.filter((_, j) => j !== k))}
                    className="absolute -top-1.5 -right-1.5 size-4 rounded-full border border-line-strong bg-surface text-foreground"
                  >
                    <X className="size-2.5" />
                  </Button>
                </div>
              ))}
              {Array.from({ length: preparing }, (_, k) => (
                <Skeleton key={`p${k}`} className="size-10 rounded-chip border border-line" />
              ))}
            </div>
          )}
          <div className="flex items-start gap-1.5">
            <span className="flex h-5 w-3 shrink-0 items-center justify-center">
              <Prompt />
            </span>
            <Textarea
              disabled={!!onSetup}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault()
                  void attach(e.clipboardData.files)
                }
              }}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a new line. Never while composing
                // (an IME's Enter commits the characters, it does not mean send).
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
                // The editor's own shortcuts must not fire while typing here.
                e.stopPropagation()
              }}
              rows={1}
              // Bare: the bar is the field. One line is the row's 20px, so the
              // caret sits on the prompt mark's line.
              className="max-h-40 min-h-5 rounded-none border-0 bg-transparent p-0 text-xs leading-5 shadow-none focus-visible:ring-0 md:text-xs dark:bg-transparent"
            />
            <Input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void attach(e.target.files)
                e.target.value = ""
              }}
            />
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => fileInput.current?.click()}
              disabled={busy || !!onSetup}
              tooltip={text.attach}
              aria-label={text.attach}
              className="size-5 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            >
              <ImagePlus className="size-3.5" />
            </Button>
            {busy ? (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={onStop}
                tooltip={text.stop}
                aria-label={text.stop}
                className="size-5 shrink-0 text-foreground hover:bg-transparent"
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={submit}
                disabled={locked || !!onSetup || preparing > 0 || (!draft.trim() && !refs.length)}
                tooltip={text.send}
                aria-label={text.send}
                // The prompt mark, the picture and send are one size and one
                // weight; send is told apart by colour alone — blue once there
                // is something to send.
                className="size-5 shrink-0 text-blue-400 hover:bg-transparent hover:text-blue-300 disabled:text-muted-foreground"
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
