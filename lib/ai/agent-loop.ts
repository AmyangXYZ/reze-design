// The art director's loop, in the browser: ask the model, run the tools it
// asks for, hand back what they found, and go round again until it is done.
//
// This is the whole of what makes it an agent rather than a chat. One request
// from the user can be many rounds — change, capture, judge, change again —
// with no one in between; it ends when the model stops asking for tools, when
// the user presses stop, or at a round limit that makes it wrap up.
//
// The model is reached once per round: on the person's own key, straight from
// this browser (lib/ai/providers, over their own network); on Premium,
// through /api/agent, which holds this server's key. The history
// here is APPEND-ONLY: every reply is kept exactly as it came back (thinking
// included) and nothing earlier is ever rewritten — the model's reasoning is
// bound to the history it was produced against. The one replacement is the
// newest message, swapped for the copy the server actually sent (images
// uploaded and referenced by id) before anything follows it.
//
// What is SENT is a copy with the older pictures left out and the older text
// condensed (see sendable, compact): providers with no file uploads keep
// pictures inline, and re-sending every capture, every tool result and every
// scene snapshot every round grew each request without end — 70k tokens a
// call for the heaviest Premium users, almost all of it re-read history.

import type Anthropic from "@anthropic-ai/sdk"
import type { ToolResult } from "@/lib/ai/scene-tools"
import type { Via } from "@/lib/ai/providers/presets"
import { TurnError } from "@/lib/ai/providers/types"
import { summarizeStep } from "@/lib/ai/agent-summary"

export type AgentMessage = Anthropic.Beta.BetaMessageParam

/** Tokens one reply took, the same shape whichever service answered: all of
 *  the input (cached and cache writes included), the part of it served from
 *  the cache, the part written to it where the service bills writes apart,
 *  and the output. Null where the service did not say. */
export type Usage = { input: number; output: number; cached: number; cacheWrite?: number }

export const addUsage = (a: Usage | null, b: Usage | null): Usage | null =>
  !a ? b : !b ? a : { input: a.input + b.input, output: a.output + b.output, cached: a.cached + b.cached, cacheWrite: (a.cacheWrite ?? 0) + (b.cacheWrite ?? 0) }

/** One line of /api/agent's stream. */
export type AgentStreamEvent =
  | { type: "sent"; message: AgentMessage }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string }
  | { type: "message"; content: Anthropic.Beta.BetaContentBlock[]; stopReason: string | null; usage: Usage | null }
  | { type: "error"; message: string; retryable?: boolean }

/** What the loop tells the panel as it goes. */
export type AgentProgress =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool-done"; name: string; ok: boolean }
  | { type: "history"; messages: AgentMessage[] }
  | { type: "retry"; attempt: number; reason: string }
  | { type: "usage"; usage: Usage | null }

export type AgentOutcome = { messages: AgentMessage[]; ended: "done" | "stopped" | "limit" | "refused" | "error"; error?: string }

/** Rounds before the loop tells the model to wrap up. Twelve covers change,
 *  look, fix and look again several times over; 24 let one request run to
 *  well over a million tokens of re-read history. */
export const MAX_ROUNDS = 12

/** How a note FROM THE LOOP starts — the scene it attaches to a request, the
 *  wrap-up at the round limit, the nudge to look before finishing. They ride
 *  in user turns because that is where the API takes them, and the panel
 *  leaves them out because they are not the person's words. */
export const LOOP_NOTE = "[reze] "

/** How the scene snapshot a request carries begins (hooks/use-agent). */
export const SNAPSHOT = "The scene as it stands now (get_scene): "

/** The note on the last round's results. */
const LAST_ROUND = `${LOOP_NOTE}That is the last round for this request. Do not call more tools: say what you changed, where it stands, and what is left.`

/** Tries per round when the failure is the network's or the provider's
 *  moment, not the request's. */
const ATTEMPTS = 3

/** Tools that change the scene, and tools that look at it. A run that changed
 *  it after its last look is asked to look once before it finishes. */
export const CHANGES = new Set([
  "set_settings", "set_grade", "set_camera", "frame_shot", "assign_shader", "apply_look_pack", "set_shader_inputs",
  "add_effect", "update_effect", "remove_effect", "add_lamp", "update_lamp", "remove_lamp", "set_visibility", "reset_to_default",
])
const LOOKS = new Set(["capture", "filmstrip"])

/** Wait, unless stopped first. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true })
  })

type Round =
  | { ok: true; reply: Extract<AgentStreamEvent, { type: "message" }> }
  | { ok: false; error: string; retryable: boolean }

/** A tool's result as the model reads it: the data as JSON, then its images. */
export function toolResultBlock(id: string, result: ToolResult): Anthropic.Beta.BetaToolResultBlockParam {
  const data = result.data as { error?: unknown } | null
  const content: Anthropic.Beta.BetaToolResultBlockParam["content"] = [{ type: "text", text: JSON.stringify(result.data) }]
  for (const im of result.images ?? []) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.*)$/.exec(im.dataUrl)
    if (!m) continue
    content.push({ type: "text", text: `Image: ${im.label}` })
    content.push({ type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } })
  }
  return { type: "tool_result", tool_use_id: id, content, ...(data && typeof data === "object" && "error" in data ? { is_error: true } : {}) }
}

/** Messages whose inline pictures are re-sent; earlier ones are mentioned. */
const KEEP_PICTURES = 3

/** Rounds of the current request whose tool results go in full. */
const FULL_ROUNDS = 3
/** A string in an earlier request's tool call longer than this — a whole
 *  effect's WGSL, a shader graph — goes as its opening and its length. */
const LONG_INPUT = 600

/** A user message carrying the person's own words — a request — rather than
 *  only tool results or the loop's own notes. */
const isRequest = (m: AgentMessage) =>
  m.role === "user" &&
  (typeof m.content === "string" || m.content.some((b) => b.type === "text" && !b.text.startsWith(LOOP_NOTE)))

/**
 * The text a model has already read and acted on, condensed. Pictures are not
 * touched here (they keep their own window and full quality: what the model
 * SEES decides how good its work is), and neither is anything it said.
 *
 * - Scene snapshots: only the newest goes. Each request attaches one, and
 *   the older ones describe a scene that no longer exists.
 * - Tool results: in full for the last few rounds of the current request,
 *   as their one-line summary (lib/ai/agent-summary, what the panel shows)
 *   before that. The model can call the tool again for the full data.
 * - Tool calls from earlier requests: long strings (code it wrote) shortened.
 *
 * Deterministic, so a message once condensed reads the same every round and
 * the prefix before the newest rounds stays in the provider's prompt cache.
 */
export function compact(messages: AgentMessage[]): AgentMessage[] {
  type B = Anthropic.Beta.BetaContentBlockParam
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>()
  for (const m of messages)
    if (m.role === "assistant" && Array.isArray(m.content))
      for (const b of m.content) if (b.type === "tool_use") calls.set(b.id, { name: b.name, input: (b.input ?? {}) as Record<string, unknown> })

  let request = -1
  messages.forEach((m, i) => {
    if (isRequest(m)) request = i
  })
  const withResults = messages.flatMap((m, i) =>
    i > request && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result") ? [i] : [],
  )
  const full = new Set(withResults.slice(-FULL_ROUNDS))
  let snapshot = -1
  messages.forEach((m, i) => {
    if (Array.isArray(m.content) && m.content.some((b) => b.type === "text" && b.text.startsWith(LOOP_NOTE + SNAPSHOT))) snapshot = i
  })

  const condensed = (id: string, text: string): string => {
    const call = calls.get(id)
    if (!call) return text.length > LONG_INPUT ? `${text.slice(0, 200)}… (earlier result, condensed)` : text
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = { error: text.length > 300 ? `${text.slice(0, 300)}…` : text }
    }
    const { title, detail } = summarizeStep(call.name, call.input, data)
    return `Earlier result, condensed — ${title}${detail ? `: ${detail}` : ""}. Call ${call.name} again for the full data.`
  }
  const shorten = (v: unknown): unknown =>
    typeof v === "string"
      ? v.length > LONG_INPUT
        ? `${v.slice(0, 160)}… (${v.length} characters, sent in full earlier)`
        : v
      : Array.isArray(v)
        ? v.map(shorten)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x)]))
          : v

  return messages.map((m, i) => {
    if (typeof m.content === "string") return m
    if (m.role === "assistant") {
      if (i > request) return m
      return { ...m, content: m.content.map((b) => (b.type === "tool_use" ? { ...b, input: shorten(b.input) } : b)) as B[] }
    }
    const keepResults = full.has(i)
    const content = m.content.map((b): B => {
      if (b.type === "text" && i !== snapshot && b.text.startsWith(LOOP_NOTE + SNAPSHOT))
        return { type: "text", text: `${LOOP_NOTE}(An earlier scene snapshot, superseded by a later one.)` }
      if (b.type !== "tool_result" || keepResults) return b
      if (typeof b.content === "string") return { ...b, content: condensed(b.tool_use_id, b.content) }
      if (!Array.isArray(b.content)) return b
      // The data is the first text block (toolResultBlock). Image labels and
      // pictures after it are left for sendable's picture window.
      let first = true
      const inner = b.content.map((x) => {
        if (x.type !== "text" || !first) return x
        first = false
        return { ...x, text: condensed(b.tool_use_id, x.text) }
      })
      return { ...b, content: inner }
    })
    return { ...m, content }
  })
}

/**
 * The history as sent: condensed (compact), then inline (base64) pictures
 * from tool results only in the latest few messages that have any; earlier
 * ones become a line saying they were seen. The person's own reference
 * pictures always go — they are the request. Uploaded pictures are
 * references, small enough to always go. A model that reads text only
 * (`keep` 0) is sent no picture at all.
 */
export function sendable(history: AgentMessage[], keep = KEEP_PICTURES): AgentMessage[] {
  const messages = compact(history)
  type B = Anthropic.Beta.BetaContentBlockParam
  const capture = (b: B) => b.type === "tool_result" && Array.isArray(b.content) && b.content.some((x) => x.type === "image" && x.source.type === "base64")
  const withPictures = messages.flatMap((m, i) => (Array.isArray(m.content) && m.content.some(capture) ? [i] : []))
  const kept = new Set(keep ? withPictures.slice(-keep) : [])
  const note = keep ? "(An earlier image, not re-sent; you saw it then.)" : "(An image, not shown: this model reads text only.)"
  const drop = (b: B, inResult: boolean): B =>
    b.type === "image" && (!keep || (inResult && b.source.type === "base64"))
      ? { type: "text", text: note }
      : b.type === "tool_result" && Array.isArray(b.content)
        ? { ...b, content: b.content.map((x) => drop(x as B, true)) as typeof b.content }
        : b
  return messages.map((m, i) => (kept.has(i) || typeof m.content === "string" ? m : { ...m, content: m.content.map((b) => drop(b, false)) }))
}

/**
 * The history a provider is sent. Claude is sent it WHOLE: its signed thinking
 * is bound to the exact history it was produced against, and a rewritten
 * earlier turn — an old picture swapped for a line of text — is refused
 * outright for newer Anthropic accounts (a 400) and silently drops the
 * reasoning for older ones, besides moving the cached prefix back every round.
 * Its old results are cleared on Anthropic's side instead (context_management
 * in providers/anthropic), which is not an edit. Everyone else carries no
 * such binding and is sent the trimmed copy.
 */
export function historyFor(api: "anthropic" | "openai" | "compat", messages: AgentMessage[], seeing: boolean): AgentMessage[] {
  if (api === "anthropic" && seeing) return messages
  return sendable(messages, seeing ? KEEP_PICTURES : 0)
}

/** Read an NDJSON response line by line. */
async function* lines(res: Response): AsyncGenerator<AgentStreamEvent> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) yield JSON.parse(line) as AgentStreamEvent
    }
  }
  if (buf.trim()) yield JSON.parse(buf) as AgentStreamEvent
}

/**
 * Run the loop from `history`, whose last message is the user's new request.
 * Resolves with the history as it stands at the end — always well-formed:
 * every tool call the model made has its answer, even when stopped.
 */
export async function runAgent(opts: {
  history: AgentMessage[]
  runTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>
  onProgress: (p: AgentProgress) => void
  signal: AbortSignal
  /** The person's own connection, called from this browser; absent means
   *  Premium, through the server. */
  via?: Via | null
  endpoint?: string
  maxRounds?: number
}): Promise<AgentOutcome> {
  const messages = [...opts.history]
  const max = opts.maxRounds ?? MAX_ROUNDS
  const publish = () => opts.onProgress({ type: "history", messages: [...messages] })
  // Changes made since the last look, and whether it has been asked to look.
  // One change is a direct edit — a value set as asked — and finishing on it
  // costs nothing to trust. Two or more unseen is where a weaker model goes
  // wrong without knowing, so that run looks before it finishes.
  let unseen = 0
  let nudged = false
  // A text reply cut off at the token limit is continued once per request.
  let continued = false

  /** One request to the model. A failure says whether trying again could help:
   *  the network, a busy or failing provider, a stream cut short — yes; a
   *  refused or malformed request — no. */
  const ask = async (): Promise<Round> => {
    let done = null as Round | null
    const handle = (e: AgentStreamEvent) => {
      if (e.type === "sent") {
        messages[messages.length - 1] = e.message
        publish()
      } else if (e.type === "text" || e.type === "thinking") opts.onProgress(e)
      else if (e.type === "message") done = { ok: true, reply: e }
      else if (e.type === "error") done = { ok: false, error: e.message, retryable: e.retryable === true }
    }

    // Their own key: the browser calls the service itself.
    if (opts.via) {
      try {
        const [{ routeOf }, { AGENT_SYSTEM, AGENT_TOOLS, TEXT_ONLY_NOTE, modelNote }] = await Promise.all([import("@/lib/ai/providers"), import("@/lib/ai/agent-context")])
        const route = routeOf(opts.via)
        if ("error" in route) return { ok: false, error: route.error, retryable: false }
        const seeing = opts.via.vision !== false
        await route.provider.turn({
          target: route.target,
          messages: historyFor(route.provider.api, messages, seeing),
          system: (seeing ? AGENT_SYSTEM : AGENT_SYSTEM + TEXT_ONLY_NOTE) + modelNote(route.target.model),
          tools: AGENT_TOOLS,
          send: handle,
          signal: opts.signal,
        })
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: e instanceof TurnError ? e.retryable : true }
      }
      return done ?? { ok: false, error: "the reply was cut off", retryable: true }
    }

    let res: Response
    try {
      res = await fetch(opts.endpoint ?? "/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: sendable(messages) }),
        signal: opts.signal,
      })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true }
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; retryable?: boolean }
      return { ok: false, error: body.error ?? `HTTP ${res.status}`, retryable: body.retryable ?? [429, 502, 504].includes(res.status) }
    }
    try {
      for await (const e of lines(res)) {
        handle(e)
        if (done) return done
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true }
    }
    return { ok: false, error: "the reply was cut off", retryable: true }
  }

  for (let round = 0; ; round++) {
    if (opts.signal.aborted) return { messages, ended: "stopped" }
    let got = await ask()
    for (let attempt = 1; !got.ok && got.retryable && attempt < ATTEMPTS && !opts.signal.aborted; attempt++) {
      opts.onProgress({ type: "retry", attempt, reason: got.error })
      await pause(1500 * 2 ** (attempt - 1), opts.signal)
      if (opts.signal.aborted) break
      got = await ask()
    }
    if (opts.signal.aborted) return { messages, ended: "stopped" }
    if (!got.ok) return { messages, ended: "error", error: got.error }
    const reply = got.reply
    opts.onProgress({ type: "usage", usage: reply.usage })

    messages.push({ role: "assistant", content: reply.content as Anthropic.Beta.BetaContentBlockParam[] })
    publish()
    if (reply.stopReason === "refusal") return { messages, ended: "refused" }
    // Every call counts toward the limit. The one after the last round is the
    // wrap-up: it may only answer, so nothing it asks for runs.
    const wrapUp = round >= max
    const lastNote: Anthropic.Beta.BetaTextBlockParam[] = round + 1 === max ? [{ type: "text", text: LAST_ROUND }] : []
    if (reply.stopReason === "pause_turn") {
      if (wrapUp) return { messages, ended: "limit" }
      continue
    }

    const calls = reply.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
    if (calls.length === 0) {
      // A reply cut off at the token limit: ask once for the rest.
      if (reply.stopReason === "max_tokens" && !continued && !wrapUp) {
        continued = true
        messages.push({ role: "user", content: [{ type: "text", text: `${LOOP_NOTE}Your reply was cut off — finish it in a few lines.` }, ...lastNote] })
        publish()
        continue
      }
      // Finished without looking at what it changed: ask once to check.
      if (unseen >= 2 && !nudged && round + 1 < max) {
        nudged = true
        messages.push({
          role: "user",
          content: [{ type: "text", text: `${LOOP_NOTE}You changed the scene after your last look at it. Capture once, check the result against the request and fix anything off, then finish with your reply.` }],
        })
        publish()
        continue
      }
      return { messages, ended: "done" }
    }
    const unrun = (why: string) => calls.map((c) => ({ type: "tool_result" as const, tool_use_id: c.id, is_error: true, content: why }))
    if (wrapUp) {
      messages.push({ role: "user", content: unrun("Round limit reached — not run.") })
      publish()
      return { messages, ended: "limit" }
    }
    // A call cut off at the token limit may parse as a smaller valid one;
    // never run it.
    if (reply.stopReason === "max_tokens") {
      messages.push({ role: "user", content: [...unrun("Your reply hit the length limit before this call was complete; it was not run."), ...lastNote] })
      publish()
      continue
    }

    // One at a time, in order: each tool sees the scene the one before left
    // (useSceneTools waits a render after each).
    const results: Anthropic.Beta.BetaContentBlockParam[] = []
    for (const call of calls) {
      if (opts.signal.aborted) {
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "Stopped by the user before this ran." })
        continue
      }
      const input = (call.input ?? {}) as Record<string, unknown>
      opts.onProgress({ type: "tool", name: call.name, input })
      const result = await opts.runTool(call.name, input)
      const block = toolResultBlock(call.id, result)
      if (!block.is_error && CHANGES.has(call.name)) unseen++
      if (!block.is_error && LOOKS.has(call.name)) unseen = 0
      opts.onProgress({ type: "tool-done", name: call.name, ok: !block.is_error })
      results.push(block)
    }
    if (!opts.signal.aborted) results.push(...lastNote)
    messages.push({ role: "user", content: results })
    publish()
    if (opts.signal.aborted) return { messages, ended: "stopped" }
  }
}

/**
 * A saved history made whole again. A page closed mid-run can leave the last
 * reply's tool calls with no answers, and the API refuses a history like that
 * — so each one is answered as interrupted. Appended, never rewritten: the
 * history stays a prefix of itself.
 */
export function settle(messages: AgentMessage[]): AgentMessage[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "assistant" || typeof last.content === "string") return messages
  const calls = last.content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use")
  if (!calls.length) return messages
  return [
    ...messages,
    {
      role: "user",
      content: calls.map((c) => ({ type: "tool_result" as const, tool_use_id: c.id, is_error: true, content: "Interrupted: the page was closed before this ran." })),
    },
  ]
}

/** Every uploaded file the conversation references — to delete with it. */
export function filesIn(messages: AgentMessage[]): string[] {
  const out = new Set<string>()
  const walk = (b: unknown) => {
    if (!b || typeof b !== "object") return
    const block = b as { type?: string; source?: { type?: string; file_id?: string }; content?: unknown }
    if (block.type === "image" && block.source?.type === "file" && block.source.file_id) out.add(block.source.file_id)
    if (Array.isArray(block.content)) block.content.forEach(walk)
  }
  for (const m of messages) if (Array.isArray(m.content)) m.content.forEach(walk)
  return [...out]
}
