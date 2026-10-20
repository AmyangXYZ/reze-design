import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The chrome's own type sizes (app/globals.css), named so a merge reads them
// as sizes: unknown, `text-display` would pass for a colour and lose to
// `text-foreground`.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["2xs", "display", "masthead"] }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
