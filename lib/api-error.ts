// The server's reason, in the reader's language.
//
// Every mutation in the libraries and the gallery used to end in
// `res.ok && applyIt()`: a failure changed nothing on screen and said nothing,
// so a rename that the server refused looked exactly like a rename that had not
// been typed yet. The routes were already answering WHY — `name-taken`,
// `private-uses` — and nothing read it.
//
// Codes rather than server prose: the API answers in one language and the UI
// speaks two, so the mapping belongs here. An unrecognised code falls back to
// the generic line instead of showing a reader a machine token.

/** Error codes the library routes return. */
export type ApiErrorCode = "name-taken" | "cannot-unpublish" | "private-uses" | "unknown"

export type ApiError = {
  code: ApiErrorCode
  /** Extra the route sent with it — the names a `private-uses` refusal listed,
   *  or the item already holding a taken name. */
  detail?: string
}

/**
 * Read a failed Response into something showable.
 *
 * Never throws and never rejects: this runs on the failure path, and a parse
 * error there would replace a message the reader needs with a crash.
 */
export async function apiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as
    | { error?: unknown; taken?: unknown; uses?: unknown }
    | null
  const code = typeof body?.error === "string" ? body.error : ""
  const uses = Array.isArray(body?.uses) ? body.uses.filter((u): u is string => typeof u === "string") : []
  const taken = typeof body?.taken === "string" ? body.taken : undefined
  const known: ApiErrorCode[] = ["name-taken", "cannot-unpublish", "private-uses"]
  return {
    code: (known as string[]).includes(code) ? (code as ApiErrorCode) : "unknown",
    detail: uses.length ? uses.join(", ") : taken,
  }
}
