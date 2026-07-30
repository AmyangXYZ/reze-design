"use client"

// A surface that raises itself when clicked or focused, without its owner
// subscribing to the stacking order.
//
// `useZOrder` subscribes via useSyncExternalStore, so calling it inside a large
// component means every raise re-renders that component. Doing that in page.tsx
// re-created the shader-graph editor's JSX, and ReactFlow's canvas visibly
// repainted whenever a dock came forward. Keeping the subscription in here means
// only this wrapper re-renders — `children` arrive as already-built elements and
// are reused untouched.

import type { ReactNode } from "react"
import { useZOrder } from "@/hooks/use-z-order"

export function RaisableLayer({ className, children }: { className?: string; children: ReactNode }) {
  const { z, onPointerDownCapture, onFocusCapture } = useZOrder()
  return (
    <div
      className={className}
      style={{ zIndex: z }}
      onPointerDownCapture={onPointerDownCapture}
      onFocusCapture={onFocusCapture}
    >
      {children}
    </div>
  )
}
