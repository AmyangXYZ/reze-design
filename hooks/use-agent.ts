"use client"

// The art director's conversation, for the panel: the history, what is
// happening right now, and send / stop / start over.
//
// One request is one undo step — the scene's history is told when a run starts
// and ends, so ⌘Z takes back everything the director did for that request at
// once rather than one tool at a time.
//
// The conversation is SAVED in this browser and survives a reload and a change
// of scene; only New conversation clears it. Opening another scene does stop a
// run in progress — its tools would be acting on the wrong scene — but keeps
// what was said.

import { useCallback, useEffect, useRef, useState } from "react"
import type { ToolResult } from "@/lib/ai/scene-tools"
import { LOOP_NOTE, filesIn, runAgent, settle, type AgentMessage, type AgentOutcome } from "@/lib/ai/agent-loop"
import { storageKey } from "@/lib/storage"
import { referenceBlocks, type ReferenceImage } from "@/lib/ai/reference-image"

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

const STORE = storageKey("agent.conversation")
type Saved = { messages: AgentMessage[]; thumbs: Record<number, string[]> }

function load(): Saved {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORE) : null
    if (!raw) return { messages: [], thumbs: {} }
    const saved = JSON.parse(raw) as Saved
    return { messages: settle(Array.isArray(saved.messages) ? saved.messages : []), thumbs: saved.thumbs ?? {} }
  } catch {
    return { messages: [], thumbs: {} }
  }
}

/** Write the conversation; if the browser's storage is full, try again
 *  without the attached pictures (the history itself is what matters). */
function save(saved: Saved) {
  try {
    if (!saved.messages.length) window.localStorage.removeItem(STORE)
    else window.localStorage.setItem(STORE, JSON.stringify(saved))
  } catch {
    try {
      window.localStorage.setItem(STORE, JSON.stringify({ messages: saved.messages, thumbs: {} }))
    } catch {
      /* storage blocked or full — the conversation lives for this tab only */
    }
  }
}

export function useAgent({
  scene,
  runTool,
  begin,
  end,
}: {
  /** The open scene's identity: a new one stops a run in progress. */
  scene: unknown
  runTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>
  /** Group the run's changes into one undo step. */
  begin: (label?: string) => void
  end: () => void
}) {
  // Read once, on first render. The panel is drawn only after mount, so this
  // cannot disagree with the server's render.
  const [initial] = useState(load)
  const [messages, setMessages] = useState<AgentMessage[]>(initial.messages)
  const [live, setLive] = useState<AgentLive>(IDLE)
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<AgentRun | null>(null)
  // Reference images by the index of the message that carried them. Once sent
  // they live in the history as uploaded file ids, which the tab cannot show;
  // this keeps the pictures the person attached for the transcript.
  const [thumbs, setThumbs] = useState<Record<number, string[]>>(initial.thumbs)
  const [outcome, setOutcome] = useState<AgentOutcome["ended"] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const history = useRef<AgentMessage[]>(initial.messages)

  // Saved as it changes, a beat after — not on every streamed token.
  useEffect(() => {
    const id = setTimeout(() => save({ messages, thumbs }), 400)
    return () => clearTimeout(id)
  }, [messages, thumbs])

  const forget = useCallback((list: AgentMessage[]) => {
    const files = filesIn(list)
    if (files.length) void fetch("/api/agent", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) }).catch(() => null)
  }, [])

  // A different scene stops a run in progress (its tools would act on the new
  // scene) and keeps the conversation. Only on a REAL change: effects also
  // re-run when the module is hot reloaded in development, and an
  // unconditional abort here stopped the run every time a file was saved.
  const runFor = useRef(scene)
  useEffect(() => {
    if (runFor.current === scene) return
    runFor.current = scene
    abort.current?.abort()
  }, [scene])

  const send = useCallback(
    async (text: string, refs: ReferenceImage[] = []) => {
      // A picture with no words asks for its look.
      const request = text.trim() || (refs.length ? "Make the scene follow this reference image's style." : "")
      if (!request || abort.current) return
      const controller = new AbortController()
      abort.current = controller
      const at = history.current.length
      // The scene as it stands rides with every request, so the model starts
      // from the truth instead of spending its first round asking for it.
      const now = await runTool("get_scene", {}).catch(() => null)
      const start: AgentMessage[] = [
        ...history.current,
        {
          role: "user",
          content: [
            ...referenceBlocks(refs),
            { type: "text", text: request },
            ...(now ? [{ type: "text" as const, text: `${LOOP_NOTE}The scene as it stands now (get_scene): ${JSON.stringify(now.data)}` }] : []),
          ],
        },
      ]
      if (refs.length) setThumbs((t) => ({ ...t, [at]: refs.map((r) => r.dataUrl) }))
      history.current = start
      setMessages(start)
      setBusy(true)
      setOutcome(null)
      setError(null)
      setLive(IDLE)
      setRun({ startedAt: Date.now(), steps: 0 })
      begin(request.length > 40 ? `${request.slice(0, 40)}…` : request)
      try {
        const out = await runAgent({
          history: start,
          runTool,
          signal: controller.signal,
          onProgress: (p) => {
            if (p.type === "history") {
              history.current = p.messages
              setMessages(p.messages)
              // A new round's stream starts clean.
              setLive(IDLE)
            } else if (p.type === "text") setLive((l) => ({ ...l, text: l.text + p.text, tool: null }))
            else if (p.type === "thinking") setLive((l) => ({ ...l, thinking: l.thinking + p.text }))
            else if (p.type === "tool") setLive((l) => ({ ...l, tool: p.name, retrying: false }))
            else if (p.type === "retry") setLive((l) => ({ ...l, retrying: true }))
            else if (p.type === "tool-done") {
              setLive((l) => ({ ...l, tool: null }))
              setRun((r) => (r ? { ...r, steps: r.steps + 1 } : r))
            }
          },
        })
        history.current = out.messages
        setMessages(out.messages)
        setOutcome(out.ended)
        setError(out.error ?? null)
      } finally {
        end()
        abort.current = null
        setBusy(false)
        setRun(null)
        setLive(IDLE)
      }
    },
    [runTool, begin, end],
  )

  const stop = useCallback(() => abort.current?.abort(), [])

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
      messages: () => history.current,
    }
    return () => {
      delete w.rezeAgent
    }
  }, [send, stop])

  const reset = useCallback(() => {
    abort.current?.abort()
    forget(history.current)
    history.current = []
    setMessages([])
    setThumbs({})
    setOutcome(null)
    setError(null)
  }, [forget])

  return { messages, thumbs, live, busy, run, outcome, error, send, stop, reset }
}
