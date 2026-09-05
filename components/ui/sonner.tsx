"use client"

// shadcn's Sonner, wearing the editor's chrome.
//
// Two departures from the generated file, both forced by this app:
//
// THEME IS PINNED DARK rather than read from next-themes. There is no
// ThemeProvider here — <html> carries `dark` unconditionally — so `useTheme()`
// would report "system" and Sonner would resolve that against the OS, painting
// a light toast over a dark editor for anyone whose machine is set to light.
//
// COLOURS COME FROM THE CHROME TOKENS, not from --popover. A toast is chrome
// stacked over other chrome, which is what `surface-raised` and `line-strong`
// are for; see AGENTS.md. Sonner reads these four CSS variables, so mapping
// them here is the whole of the styling and no class overrides are needed.

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      // Bottom-right: the transport owns the bottom-centre and the inspector the
      // right edge, so this is the corner where a box of text covers nothing
      // anyone is reading.
      position="bottom-right"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--color-surface-raised)",
          "--normal-text": "var(--color-foreground)",
          "--normal-border": "var(--color-line-strong)",
          "--border-radius": "var(--radius-surface)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
