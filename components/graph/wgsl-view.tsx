"use client"

// Syntax-highlighted WGSL with line numbers. refractor ships a real wgsl grammar
// (prismjs ≥1.27), so no rust-approximation needed. The outer container in the
// page owns scrolling; the highlighter's <pre> stays overflow-visible.

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"

export function WgslView({ code }: { code: string }) {
  return (
    <SyntaxHighlighter
      language="wgsl"
      style={oneDark}
      showLineNumbers
      customStyle={{
        margin: 0,
        padding: "0.75rem",
        background: "transparent",
        fontSize: "10.5px",
        lineHeight: "1.55",
        overflow: "visible",
      }}
      lineNumberStyle={{
        minWidth: "2.5em",
        paddingRight: "1em",
        color: "oklch(0.42 0.01 260)",
        userSelect: "none",
      }}
      codeTagProps={{ style: { fontSize: "10.5px" } }}
    >
      {code}
    </SyntaxHighlighter>
  )
}
