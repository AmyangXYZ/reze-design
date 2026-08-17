// Every localStorage key this app owns, versioned in one place.
//
// Browser storage outlives releases: a scene document, a draft or a saved look
// written by an older build sits there forever, and the code that reads it has
// long since changed shape. Rather than teach every reader to recognise and
// migrate every past shape, the keys carry the version that wrote them — a new
// version simply does not see the old data, and the old data ages out.
//
// The cost is real and deliberate: bumping this DISCARDS what the previous
// version stored. That is the right trade for a beta whose document shape is
// still moving, and the wrong one once scenes are precious — at which point
// this becomes a migration table instead, keyed by the same version string.

export const STORAGE_VERSION = "0.5.0"

/** `reze-design.<name>.<version>` — the only way a key should be spelled. */
export function storageKey(name: string): string {
  return `reze-design.${name}.${STORAGE_VERSION}`
}
