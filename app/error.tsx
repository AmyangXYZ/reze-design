"use client" // Error boundaries must be Client Components

// The boundary around every route below the root layout — which in practice is
// the editor and the viewer, i.e. everywhere a scene renders.

import { CrashScreen } from "@/components/crash-screen"

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  // Retry re-fetches and re-renders the children. Worth offering: a good share of
  // what reaches here is a transient asset or network failure, and recovering in
  // place keeps the scene rather than reloading the tab out from under it.
  return <CrashScreen error={error} retry={unstable_retry} />
}
