// How a run ended, said to the person — never a bare "Stopped" or a raw error.
//
// The loop reports what happened in its own terms (lib/ai/agent-loop: done,
// stopped, limit, refused, error + the server's message). This turns that into
// one of a small set of situations, each with words that say what happened
// and what to do about it, and the one action that helps: try the same
// request again, carry on past the step limit, or start a new conversation.
// Pure, so every mapping is tested (agent-notice.test.mts).

import type { AgentOutcome } from "@/lib/ai/agent-loop"

export type NoticeKind =
  | "stopped" // the person pressed Stop
  | "stoppedScene" // another scene was opened mid-run
  | "interrupted" // the page closed mid-run; found on the next load
  | "limit" // the step limit for one request
  | "refused" // the model declined
  | "signIn"
  | "premium"
  | "rateLimited" // our own per-minute guard
  | "busy" // the provider is overloaded or rate-limiting
  | "network" // the connection dropped, or the reply was cut off
  | "tooLarge" // the request body (an image) was too big
  | "notSetUp" // the server has no key for the provider
  | "broken" // the provider refused the conversation itself (a 4xx)
  | "unknown"

export type NoticeAction = "retry" | "continue" | "newChat"

export type Notice = {
  kind: NoticeKind
  /** The one thing worth offering, if any. */
  action?: NoticeAction
  /** Whether changes made before it ended are worth mentioning as kept. */
  kept: boolean
  /** The underlying message, for the cases where it adds something. */
  detail?: string
}

const ACTION: Partial<Record<NoticeKind, NoticeAction>> = {
  interrupted: "retry",
  limit: "continue",
  rateLimited: "retry",
  busy: "retry",
  network: "retry",
  broken: "newChat",
  unknown: "retry",
}

/** Which situation an error message describes. */
export function errorKind(error: string): NoticeKind {
  const e = error.toLowerCase()
  if (e === "unauthenticated") return "signIn"
  if (e === "premium") return "premium"
  if (e === "slow down" || e.includes("http 429")) return "rateLimited"
  if (e === "too large" || e.includes("http 413")) return "tooLarge"
  if (e.includes("has no") && e.includes("api_key")) return "notSetUp"
  if (e.includes("busy") || e.includes("overloaded") || /model error 5\d\d/.test(e) || /model error 429/.test(e)) return "busy"
  if (e.includes("connection") || e.includes("failed to fetch") || e.includes("networkerror") || e.includes("cut off") || e.includes("network")) return "network"
  if (/model error 4\d\d/.test(e)) return "broken"
  return "unknown"
}

export function noticeOf(ended: AgentOutcome["ended"] | "interrupted" | null, error: string | null, stoppedBy: "user" | "scene" | null): Notice | null {
  if (!ended || ended === "done") return null
  const kind: NoticeKind =
    ended === "stopped" ? (stoppedBy === "scene" ? "stoppedScene" : "stopped") : ended === "error" ? errorKind(error ?? "") : ended
  return {
    kind,
    action: ACTION[kind],
    // Account and setup refusals happen before anything ran.
    kept: !["signIn", "premium", "notSetUp", "rateLimited", "tooLarge"].includes(kind),
    // The raw message only where our words are general.
    ...(kind === "unknown" || kind === "broken" ? { detail: error ?? undefined } : {}),
  }
}
