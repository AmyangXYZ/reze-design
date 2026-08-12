// Plain module, deliberately NOT "use client": both the server page and the client
// tables import this. Exporting a value from a client module gives the server a
// client *reference* rather than the array itself, which fails at `.map`.

export const KINDS = [
  { kind: "scene", label: "Scenes" },
  { kind: "graph", label: "Shader graphs" },
  { kind: "effect", label: "Effects" },
  { kind: "grade", label: "Colour grades" },
] as const

export type KindKey = (typeof KINDS)[number]["kind"]
