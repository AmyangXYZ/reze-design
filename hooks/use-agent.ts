"use client"

// The art director's conversations, for the panel: tabs of them, the open
// one's history, what is happening right now, and send / stop.
//
// One request is one undo step — the scene's history is told when a run starts
// and ends, so ⌘Z takes back everything the director did for that request at
// once rather than one tool at a time.
//
// Every conversation is SAVED in this browser (IndexedDB) and survives a
// reload and a change of scene; closing its tab deletes it. Opening another
// scene does stop a run in progress — its tools would be acting on the wrong
// scene — but keeps what was said. A run belongs to the conversation it
// started in, so tabs hold still while one is going.

import { useCallback, useEffect, useRef, useState } from "react"
import type { ToolResult } from "@/lib/ai/scene-tools"
import { CHANGES, LOOP_NOTE, addUsage, filesIn, runAgent, settle, type AgentMessage, type Usage } from "@/lib/ai/agent-loop"
import { noticeOf, type Notice } from "@/lib/ai/agent-notice"
import { referenceBlocks, type ReferenceImage } from "@/lib/ai/reference-image"
import {
  deleteConversation,
  loadConversation,
  loadIndex,
  saveConversation,
  saveIndex,
  type ConversationTab,
} from "@/lib/ai/conversation-store"
import { deleteOwnFiles } from "@/lib/ai/connections"
import type { Via } from "@/lib/ai/providers/presets"

export type AgentLive = {
  /** The reply as it streams, this round. */
  text: string
  /** The latest reasoning summary, this round. */
  thinking: string
  /** The tool running now. */
  tool: string | null
  /** Set while a failed request waits to be tried again. */
  retrying: boolean
}

const IDLE: AgentLive = { text: "", thinking: "", tool: null, retrying: false }

/** The run as a whole, for the spinner: when it started, steps finished. */
export type AgentRun = { startedAt: number; steps: number }

/** A tab's title: the first request, shortened. */
const titleOf = (request: string) => (request.length > 32 ? `${request.slice(0, 32).trimEnd()}…` : request)

export function useAgent({
  scene,
  via,
  ready,
  runTool,
  begin,
  end,
}: {
  /** The open scene's identity: a new one stops a run in progress. */
  scene: unknown
  /** The person's own connection, or null for Premium. Read when a run
   *  starts: switching mid-run takes effect on the next request. */
  via: Via | null
  /** A model to ask: the person's own, or Premium. Without one a request
   *  says to add a model rather than asking anyone. */
  ready: boolean
  runTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>
  /** Group the run's changes into one undo step. */
  begin: (label?: string) => void
  end: () => void
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [live, setLive] = useState<AgentLive>(IDLE)
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<AgentRun | null>(null)
  // Reference images by the index of the message that carried them. Once sent
  // they live in the history as uploaded file ids, which the tab cannot show;
  // this keeps the pictures the person attached for the transcript.
  const [thumbs, setThumbs] = useState<Record<number, string[]>>({})
  // How the last run ended, said plainly (lib/ai/agent-notice). A page that
  // closed mid-run is said on the next load.
  const [notice, setNotice] = useState<Notice | null>(null)
  // The open conversation's tokens, added up over every request — undefined
  // before any, null where none was reported. It only grows; a new tab starts
  // it. For the person's own information; nothing leaves.
  const [usage, setUsageState] = useState<Usage | null | undefined>(undefined)
  const usageRef = useRef<Usage | null | undefined>(undefined)
  const setUsage = useCallback((u: Usage | null | undefined) => {
    usageRef.current = u
    setUsageState(u)
  }, [])
  const abort = useRef<AbortController | null>(null)
  // Who stopped the run: the person, or a scene being opened.
  const stoppedBy = useRef<"user" | "scene" | null>(null)
  const history = useRef<AgentMessage[]>([])
  const viaRef = useRef(via)
  useEffect(() => {
    viaRef.current = via
  }, [via])
  // Nothing is saved until the saved conversation has been read, or the empty
  // first render would overwrite it.
  const [loaded, setLoaded] = useState(false)
  const [tabs, setTabs] = useState<ConversationTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  // The open conversation's id where callbacks read it, never stale.
  const active = useRef<string | null>(null)
  // What this round has streamed so far, outside React state, so a page that
  // closes mid-round can still write it down.
  const partial = useRef({ text: "", thinking: "" })
  const running = useRef(false)
  // The run, apart from what is on screen: the conversation it belongs to, its
  // history, the pictures it carries and what it has spent. Tabs can be opened
  // while it goes; its progress keeps landing in its own conversation.
  const runConv = useRef<string | null>(null)
  const runHistory = useRef<AgentMessage[]>([])
  const runThumbs = useRef<Record<number, string[]>>({})
  const runTotal = useRef<Usage | null | undefined>(undefined)
  const [runningId, setRunningId] = useState<string | null>(null)
  const viewingRun = () => runConv.current !== null && runConv.current === active.current

  /** Show one saved conversation, made whole: a page closed mid-run left
   *  tool calls unanswered, which settle() answers — and the panel says so. */
  const show = useCallback(async (id: string) => {
    active.current = id
    // Back to the tab whose run is going: its live state, not the last save.
    if (id === runConv.current) {
      setActiveId(id)
      history.current = runHistory.current
      setMessages(runHistory.current)
      setThumbs(runThumbs.current)
      setUsage(runTotal.current)
      setNotice(null)
      return
    }
    const saved = await loadConversation(id)
    // The id goes up with the conversation's own state, in one render: set
    // before the load, the panel would show this tab with the last one's
    // figures for a moment (and count from them).
    setActiveId(id)
    const settled = saved ? settle(saved.messages) : []
    history.current = settled
    setMessages(settled)
    setThumbs(saved?.thumbs ?? {})
    setUsage(saved?.usage)
    setNotice(saved && (saved.running || settled.length > saved.messages.length) ? noticeOf("interrupted", null, null) : null)
  }, [setUsage])

  const writeIndex = useCallback((next: ConversationTab[], id: string | null) => {
    setTabs(next)
    void saveIndex({ tabs: next, active: id })
  }, [])

  // The tabs, and the one that was open. A first visit gets one empty tab.
  useEffect(() => {
    void loadIndex().then(async (index) => {
      let list = index.tabs
      let id = index.active && list.some((t) => t.id === index.active) ? index.active : (list[list.length - 1]?.id ?? null)
      if (!id) {
        id = crypto.randomUUID()
        list = [{ id, title: "" }]
      }
      writeIndex(list, id)
      await show(id)
      setLoaded(true)
    })
  }, [show, writeIndex])

  // Saved as it changes, a beat after — not on every streamed token — and at
  // once when the page goes away, so closing the tab the moment a run ends
  // does not lose its last steps to the debounce.
  useEffect(() => {
    if (!loaded || !activeId) return
    const conv = activeId
    // The run's own conversation is the run's to save.
    const id = setTimeout(() => {
      if (conv !== runConv.current) void saveConversation(conv, { messages, thumbs, running: false, usage })
    }, 400)
    // Closing mid-round: what streamed so far goes down as a cut-off reply in
    // the run's conversation, so the reload shows it and Try again carries on.
    const onHide = () => {
      if (conv !== runConv.current) void saveConversation(conv, { messages: history.current, thumbs, running: false, usage })
      const rc = runConv.current
      if (!rc || !running.current) return
      const { text, thinking } = partial.current
      const cut: AgentMessage[] =
        text.trim() || thinking.trim()
          ? [{ role: "assistant", content: [...(thinking.trim() ? [{ type: "thinking" as const, thinking, signature: "" }] : []), ...(text.trim() ? [{ type: "text" as const, text }] : [])] }]
          : []
      void saveConversation(rc, { messages: [...runHistory.current, ...cut], thumbs: runThumbs.current, running: true, usage: runTotal.current })
    }
    window.addEventListener("pagehide", onHide)
    return () => {
      clearTimeout(id)
      window.removeEventListener("pagehide", onHide)
    }
  }, [messages, thumbs, loaded, activeId, usage])

  const forget = useCallback((list: AgentMessage[]) => {
    const files = filesIn(list)
    if (!files.length) return
    // Uploaded by whichever key the conversation used last.
    if (viaRef.current) void deleteOwnFiles(viaRef.current, files).catch(() => null)
    else void fetch("/api/agent", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) }).catch(() => null)
  }, [])

  // A different scene stops a run in progress (its tools would act on the new
  // scene) and keeps the conversation. Only on a REAL change: effects also
  // re-run when the module is hot reloaded in development, and an
  // unconditional abort here stopped the run every time a file was saved.
  const runFor = useRef(scene)
  useEffect(() => {
    if (runFor.current === scene) return
    runFor.current = scene
    if (!abort.current) return
    stoppedBy.current = "scene"
    abort.current.abort()
  }, [scene])

  /** Run the loop from `from` — a history ending in a user turn: a new
   *  request, or one to try again. One run is one undo step. */
  const go = useCallback(
    async (from: AgentMessage[], label: string, pictures: Record<number, string[]>) => {
      const conv = active.current
      if (!conv) return
      const controller = new AbortController()
      abort.current = controller
      stoppedBy.current = null
      runConv.current = conv
      setRunningId(conv)
      runHistory.current = from
      runThumbs.current = pictures
      // What the conversation had spent before this request; the run adds to it.
      const base = usageRef.current
      runTotal.current = base
      history.current = from
      setMessages(from)
      setThumbs(pictures)
      setBusy(true)
      running.current = true
      partial.current = { text: "", thinking: "" }
      // At once, not on the debounce: the request is the one thing a reload
      // must never lose.
      void saveConversation(conv, { messages: from, thumbs: pictures, running: true })
      setNotice(null)
      setLive(IDLE)
      setRun({ startedAt: Date.now(), steps: 0 })
      let changed = false
      let spent: Usage | null = null
      begin(label.length > 40 ? `${label.slice(0, 40)}…` : label)
      try {
        const out = await runAgent({
          history: from,
          via: viaRef.current,
          runTool,
          signal: controller.signal,
          onProgress: (p) => {
            if (p.type === "history") {
              runHistory.current = p.messages
              // A new round's stream starts clean.
              setLive(IDLE)
              partial.current = { text: "", thinking: "" }
              if (viewingRun()) {
                history.current = p.messages
                setMessages(p.messages)
              } else {
                // Watched from another tab: its conversation still keeps up.
                void saveConversation(conv, { messages: p.messages, thumbs: runThumbs.current, running: true, usage: runTotal.current })
              }
            } else if (p.type === "text") {
              partial.current.text += p.text
              setLive((l) => ({ ...l, text: l.text + p.text, tool: null }))
            } else if (p.type === "thinking") {
              partial.current.thinking += p.text
              setLive((l) => ({ ...l, thinking: l.thinking + p.text }))
            }
            else if (p.type === "tool") setLive((l) => ({ ...l, tool: p.name, retrying: false }))
            else if (p.type === "retry") setLive((l) => ({ ...l, retrying: true }))
            else if (p.type === "usage") {
              // Live: the line grows with each round instead of waiting for the end.
              spent = addUsage(spent, p.usage)
              runTotal.current = addUsage(base ?? null, spent)
              if (viewingRun()) setUsage(runTotal.current)
            }
            else if (p.type === "tool-done") {
              if (p.ok && CHANGES.has(p.name)) changed = true
              setLive((l) => ({ ...l, tool: null }))
              setRun((r) => (r ? { ...r, steps: r.steps + 1 } : r))
            }
          },
        })
        runHistory.current = out.messages
        // Requests ran: a total, or null where none of them reported one.
        const total = spent ? addUsage(base ?? null, spent) : (base ?? null)
        runTotal.current = total
        void saveConversation(conv, { messages: out.messages, thumbs: runThumbs.current, running: false, usage: total })
        if (viewingRun()) {
          history.current = out.messages
          setMessages(out.messages)
          const n = noticeOf(out.ended, out.error ?? null, stoppedBy.current)
          // "Changes made so far are kept" only when there were some.
          setNotice(n ? { ...n, kept: n.kept && changed } : null)
          setUsage(total)
        }
      } finally {
        running.current = false
        runConv.current = null
        setRunningId(null)
        end()
        abort.current = null
        setBusy(false)
        setRun(null)
        setLive(IDLE)
      }
    },
    [runTool, begin, end, setUsage],
  )

  const send = useCallback(
    async (text: string, refs: ReferenceImage[] = []) => {
      // A picture with no words asks for its look.
      const request = text.trim() || (refs.length ? "Make the scene follow this reference image's style." : "")
      if (!request || abort.current) return
      if (!ready) return setNotice(noticeOf("error", "premium", null))
      // A picture would reach a model that cannot see it; say so, send nothing.
      if (refs.length && viaRef.current?.vision === false) return setNotice({ kind: "textOnly", kept: false })
      const at = history.current.length
      // The first request names its tab.
      const id = active.current
      if (id && !tabs.find((t) => t.id === id)?.title) writeIndex(tabs.map((t) => (t.id === id ? { ...t, title: titleOf(request) } : t)), id)
      // The scene as it stands rides with every request, so the model starts
      // from the truth instead of spending its first round asking for it.
      const now = await runTool("get_scene", {}).catch(() => null)
      const pictures = refs.length ? { ...thumbs, [at]: refs.map((r) => r.dataUrl) } : thumbs
      await go(
        [
          ...history.current,
          {
            role: "user",
            content: [
              ...referenceBlocks(refs),
              { type: "text", text: request },
              ...(now ? [{ type: "text" as const, text: `${LOOP_NOTE}The scene as it stands now (get_scene): ${JSON.stringify(now.data)}` }] : []),
            ],
          },
        ],
        request,
        pictures,
      )
    },
    [runTool, go, ready, tabs, thumbs, writeIndex],
  )

  /** The notice's own action: try the failed request again from where it
   *  stopped, or carry on past the step limit. */
  const retry = useCallback(async () => {
    if (abort.current) return
    const h = history.current
    const last = h[h.length - 1]
    // Where it stopped mid-request the history ends on our side: send it again.
    if (last?.role === "user") return go(h, "AI: try again", thumbs)
    // Where the model had the last word, ask it to carry on.
    return go([...h, { role: "user", content: [{ type: "text", text: `${LOOP_NOTE}Continue where you left off.` }] }], "AI: continue", thumbs)
  }, [go, thumbs])

  const stop = useCallback(() => {
    if (!abort.current) return
    stoppedBy.current = "user"
    abort.current.abort()
  }, [])

  /** Open another tab — a run going in this one carries on in its own. */
  const switchTo = useCallback(
    async (id: string) => {
      if (id === active.current) return
      if (active.current && active.current !== runConv.current) await saveConversation(active.current, { messages: history.current, thumbs, running: false, usage })
      writeIndex(tabs, id)
      await show(id)
    },
    [tabs, thumbs, usage, show, writeIndex],
  )

  /** A new, empty conversation in a tab of its own — unless the open one is
   *  still empty, which already is that. */
  const newTab = useCallback(async () => {
    if (!history.current.length && active.current) return
    if (active.current && active.current !== runConv.current) await saveConversation(active.current, { messages: history.current, thumbs, running: false, usage })
    const id = crypto.randomUUID()
    writeIndex([...tabs, { id, title: "" }], id)
    await show(id)
  }, [tabs, thumbs, usage, show, writeIndex])

  /** Close a tab: the conversation, and what it uploaded, are deleted. */
  const closeTab = useCallback(
    async (id: string) => {
      // The run's own conversation stays until the run ends.
      if (id === runConv.current) return
      if (id === active.current) forget(history.current)
      else void loadConversation(id).then((c) => c && forget(c.messages))
      void deleteConversation(id)
      const at = tabs.findIndex((t) => t.id === id)
      const rest = tabs.filter((t) => t.id !== id)
      if (id !== active.current) return writeIndex(rest, active.current)
      // The open tab closed: its neighbour opens, or a fresh one if it was the last.
      const next = rest[Math.min(at, rest.length - 1)]?.id
      if (next) {
        writeIndex(rest, next)
        await show(next)
      } else {
        const fresh = crypto.randomUUID()
        writeIndex([{ id: fresh, title: "" }], fresh)
        await show(fresh)
      }
    },
    [tabs, forget, show, writeIndex],
  )

  // In development the director is on window.rezeAgent, like the tools on
  // rezeTools: an eval script (or a headless browser that is not signed in to
  // Premium) can send a request and read the whole conversation back.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return
    const w = window as unknown as { rezeAgent?: unknown }
    w.rezeAgent = {
      send: async (text: string, refs?: ReferenceImage[]) => {
        await send(text, refs)
        return history.current
      },
      stop,
      newTab,
      messages: () => history.current,
    }
    return () => {
      delete w.rezeAgent
    }
  }, [send, stop, newTab])

  return { tabs, activeId, runningId, switchTo, newTab, closeTab, messages, thumbs, live, busy, run, notice, usage, send, retry, stop }
}
