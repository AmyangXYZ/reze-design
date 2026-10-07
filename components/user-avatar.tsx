"use client"

// Every account's picture, in one style: the photo, or initials on the name's
// swatch.

import { tagSwatch } from "@/components/editor/library-rail"
import { cn } from "@/lib/utils"

/** Initials for a maker chip. Handles are latin; CJK display names are not, so
 *  the range is kept wide enough not to render an empty circle. */
export const initials = (n: string) => (n.match(/[a-zA-Z0-9一-鿿]/g) ?? []).slice(0, 2).join("").toUpperCase()

export function UserAvatar({
  name,
  image,
  className,
}: {
  name: string
  image?: string | null
  /** Size, and a text size for the initials when it is large. */
  className?: string
}) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" className={cn("size-4 shrink-0 rounded-full object-cover", className)} />
  }
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[8px] font-semibold",
        tagSwatch(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
