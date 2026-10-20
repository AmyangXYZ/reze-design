import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The chrome's own type sizes and shadow (app/globals.css), named so a merge
// reads them for what they are: unknown, `text-display` would pass for a colour
// and lose to `text-foreground`, and `shadow-float` would survive a
// `shadow-none` meant to replace it.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "display", "masthead"] }],
      shadow: [{ shadow: ["float"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
