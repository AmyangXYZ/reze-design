"use client" // Error boundaries must be Client Components

// The last boundary: this one catches the root layout itself failing, and it
// REPLACES that layout when it renders — so it brings its own <html>, <body> and
// stylesheet. Nothing from layout.tsx is mounted here, which is exactly why
// CrashScreen carries its own locale handling instead of using the i18n context.

import { CrashScreen } from "@/components/crash-screen"
import "./globals.css"

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <html lang="en" className="dark h-full antialiased">
      {/* No metadata export is possible in a global error, so the tab is titled here. */}
      <title>Reze Design — something broke</title>
      <body className="min-h-full text-foreground">
        <CrashScreen error={error} retry={unstable_retry} />
      </body>
    </html>
  )
}
