// Reads that survive a bad network.
//
// Every read the browser makes goes out through Cloudflare, and Cloudflare's
// plan has no edge inside mainland China: a visitor there is routed out over
// their ISP's international links, which drop packets hard at peak hours. So
// a request that fails is usually one that would succeed a second later, and a
// read that gave up after one try left the libraries with no community rows
// and a scene in default materials, with nothing on screen saying so.
//
// Two tools. `fetchJson` retries a single read through a short outage. And
// `retryLater` keeps trying a load that still failed after that, every few
// seconds while the tab is visible and the moment the network comes back, so a
// bad patch heals without a reload.
//
// That is RECOVERY, and it is quick. Picking up what other people published
// while things work is a different, slower clock: hooks/use-poll-while-open.

/** A response the server meant: retrying it would get the same answer. */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
    this.name = "HttpError"
  }
}

/** Worth asking again: the server or something in front of it had a moment. */
const transient = (status: number) => status === 408 || status === 429 || status >= 500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetch and parse JSON, retrying through a short outage.
 *
 * Each attempt has its own timeout, which covers reading the body too: a
 * stalled connection is a dropped one that has not said so, and without a
 * timeout it is never retried at all. Network errors, timeouts and 5xx/408/429
 * are retried, after 0.5s, 1.5s and 4.5s (jittered so a crowd does not retry in
 * step). Any other status is the server's answer and throws `HttpError` at once.
 *
 * Only for reads: a POST is retried as well, so it has to be one that asks
 * rather than changes (a lookup like /api/library/resolve).
 */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  { attempts = 4, timeoutMs = 15_000 }: { attempts?: number; timeoutMs?: number } = {},
): Promise<T> {
  for (let i = 0; ; i++) {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: abort.signal })
      if (!res.ok) throw new HttpError(res.status)
      return (await res.json()) as T
    } catch (e) {
      const retryable = !(e instanceof HttpError) || transient(e.status)
      if (!retryable || i + 1 >= attempts) throw e
    } finally {
      clearTimeout(timer)
    }
    await sleep(500 * 3 ** i * (0.75 + Math.random() * 0.5))
  }
}

type Wait = { cancel: () => void; fire: (force?: boolean) => void }
const waiting = new Map<string, Wait>()
/** Failures in a row per key, which set how long the next wait is. A key in
 *  here is FAILING, from its first failure until a success: that, not whether a
 *  wait is pending, is what the UI shows, so it does not flicker off while an
 *  attempt is in flight. */
const strikes = new Map<string, number>()

/** 5s, 10s, 20s, then 30s while it keeps failing. Quick for the blip it
 *  nearly always is; gentle when it is OUR side that is down, where every open
 *  tab asking every 5s would be what keeps it down. */
const retryDelay = (strike: number) => Math.min(30_000, 5_000 * 2 ** strike)

let version = 0
const watchers = new Set<() => void>()
const changed = () => {
  version++
  for (const w of watchers) w()
}

/**
 * Run `attempt` again later: after a wait that grows while it keeps failing
 * (`retryDelay`), as soon as the tab is shown again, and the moment the
 * browser says it is back online. Fires once, then stops — `attempt` is the
 * load that failed, and if it fails again it calls this again.
 *
 * One wait per `key`, so the several surfaces that share a load cannot stack
 * timers. Returns a cancel, which a component calls on unmount. The load calls
 * `retrySettled` when it succeeds, which cancels any wait and resets the delay.
 */
export function retryLater(key: string, attempt: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const held = waiting.get(key)
  if (held) return held.cancel
  const strike = strikes.get(key) ?? 0
  strikes.set(key, strike + 1)
  if (strike === 0) changed()
  const fire = (force = false) => {
    // A hidden tab is not looking; it tries when it is shown again.
    if (!force && document.visibilityState === "hidden") return
    cancel()
    attempt()
  }
  const onEvent = () => fire()
  const timer = setInterval(onEvent, retryDelay(strike))
  window.addEventListener("online", onEvent)
  document.addEventListener("visibilitychange", onEvent)
  const cancel = () => {
    clearInterval(timer)
    window.removeEventListener("online", onEvent)
    document.removeEventListener("visibilitychange", onEvent)
    if (waiting.get(key)?.cancel === cancel) waiting.delete(key)
  }
  waiting.set(key, { cancel, fire })
  return cancel
}

/** The load behind `key` succeeded: stop waiting to retry it, and start the
 *  next failure back at the short wait. */
export function retrySettled(key: string): void {
  waiting.get(key)?.cancel()
  if (strikes.delete(key)) changed()
}

/** Is any load whose key starts with one of `prefixes` failing right now? */
export function isFailing(prefixes: readonly string[]): boolean {
  for (const k of strikes.keys()) if (prefixes.some((p) => k.startsWith(p))) return true
  return false
}

/** Try those loads now, without waiting out their delay: the Retry button. */
export function retryNow(prefixes: readonly string[]): void {
  for (const [k, w] of [...waiting]) if (prefixes.some((p) => k.startsWith(p))) w.fire(true)
}

/** For useSyncExternalStore: a number that changes whenever `isFailing` might. */
export const failingVersion = () => version
export function watchFailing(w: () => void): () => void {
  watchers.add(w)
  return () => {
    watchers.delete(w)
  }
}
