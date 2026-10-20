"use client"

import * as React from "react"

/**
 * True for controls set straight on the canvas — the cover's console and its
 * bottom line — rather than inside a surface. Primitives read it for their
 * default look there: a Slider becomes a hairline, a TabsList a line of words
 * with the chosen one underlined. A surface opened from inside (a popover, a
 * dialog) is a surface again, so it sets this back to false.
 */
const CoverContext = React.createContext(false)

function Cover({ on = true, children }: { on?: boolean; children: React.ReactNode }) {
  return <CoverContext.Provider value={on}>{children}</CoverContext.Provider>
}

const useCover = () => React.useContext(CoverContext)

export { Cover, useCover }
