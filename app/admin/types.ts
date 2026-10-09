// The admin page's row shapes. Plain module — both the server page and API
// routes and the client views import these.

import type { KindKey } from "./kinds"

export type ItemRow = {
  id: string
  kind: string
  name: string
  author: string
  likeCount: number
  visibility: string
  createdAt: string
  usedInScenes: number
  exportedIn: number
  description: string
  /** A scene's cover, when it has one. */
  poster: string | null
}

export type UserRow = {
  id: string
  email: string
  name: string
  username: string | null
  image: string | null
  banned: boolean
  bannedAt: string | null
  banReason: string | null
  plan: "free" | "premium"
  emailVerified: boolean
  /** How they sign in: github, google… */
  providers: string[]
  createdAt: string
  /** Published count and likes earned, per kind. */
  perKind: Record<KindKey, { n: number; likes: number }>
  /** AI tokens on this server's key in the last 30 days (input + output). */
  aiTokens30: number
}
