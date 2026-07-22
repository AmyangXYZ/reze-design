// Shared destinations for the product's top-level nav — used both by the brand
// pill's menu on the immersive editor and by the solid header on the content
// pages (gallery / library). Keeping one source means the two never drift.

export const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Editor" },
  { href: "/gallery", label: "Gallery" },
  { href: "/library", label: "Library" },
]
