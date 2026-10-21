import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The chrome's own type sizes, shadow and radii (app/globals.css), named so a
// merge reads them for what they are: unknown, `text-display` would pass for a
// colour and lose to `text-foreground`, `shadow-float` would survive a
// `shadow-none` meant to replace it, and `rounded-surface` would stay beside
// the `rounded-interior` given in its place, its larger corner clipping the
// smaller one.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "display", "masthead"] }],
      shadow: [{ shadow: ["float"] }],
      rounded: [{ rounded: ["surface", "interior", "chip"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
