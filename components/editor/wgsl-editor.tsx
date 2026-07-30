"use client"

// WGSL editor — a free-floating, draggable, resizable panel (FloatingPanel, the graph

import { useCallback, useMemo, useRef, useState } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Code, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EditorHeader, EditorHeaderButton } from "@/components/editor/editor-header"
import { FloatingPanel, type Rect } from "@/components/editor/floating-panel"
import { useUndoScope } from "@/hooks/use-undo-scope"
import { useT } from "@/lib/i18n"

const CODE_FONT = 'var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace'
const CODE_STYLE: React.CSSProperties = {
  fontFamily: CODE_FONT,
  fontSize: "12.5px",
  fontWeight: 500,
  lineHeight: "1.6",
  tabSize: 2,
}

export type WgslCompileResult = { ok: boolean; diagnostics: string[] }

export function WgslEditorPanel({
  open,
  sessionId,
  rect,
  onRectChange,
  title,
  initial,
  onCompile,
  onClose,
}: {
  open: boolean
  /** Bumped by the opener per editing session */
  sessionId: number
  rect: Rect | null
  onRectChange: (r: Rect) => void
  title: string
  initial: string
  /** Compile + apply (the scene mirrors the editor). */
  onCompile: (wgsl: string) => Promise<WgslCompileResult>
  /** Close REQUEST, carrying the buffer as it stands — the opener decides whether
   *  that means a save prompt, a discard, or just closing. */
  onClose: (code: string) => void
}) {
  // The buffer lives in EditorBody; mirrored here so Escape (handled by the
  // panel, outside the body) can hand the same code to the close request.
  const codeRef = useRef(initial)
  if (!open || !rect) return null
  return (
    <FloatingPanel
      rect={rect}
      onRectChange={onRectChange}
      fullscreen={false}
      raiseKey={sessionId}
      onEscape={() => onClose(codeRef.current)}
      minW={420}
      minH={280}
      // z-50 like the graph editor
      className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 shadow-float"
    >
      <EditorBody
        key={sessionId}
        title={title}
        initial={initial}
        onCompile={onCompile}
        onCode={(c) => (codeRef.current = c)}
        onClose={() => onClose(codeRef.current)}
      />
    </FloatingPanel>
  )
}

function EditorBody({
  title,
  initial,
  onCompile,
  onCode,
  onClose,
}: {
  title: string
  initial: string
  onCompile: (wgsl: string) => Promise<WgslCompileResult>
  onCode: (code: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [code, setCodeState] = useState(initial)
  const setCode = (c: string) => {
    setCodeState(c)
    onCode(c)
  }
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WgslCompileResult | null>(null)
  const lineCount = useMemo(() => code.split("\n").length, [code])

  const compile = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      setResult(await onCompile(code))
    } finally {
      setBusy(false)
    }
  }, [busy, code, onCompile])

  const noop = () => {}
  const wgslScope = useUndoScope("wgsl", { undo: noop, redo: noop })

  return (
    // Claims the undo scope without registering handlers: the code lives in a real
    // <textarea>, so ⌘Z belongs to the browser's text undo. Owning the scope stops
    // the keystroke falling through to the scene panel behind it.
    <div className="flex h-full flex-col" {...wgslScope}>
      <EditorHeader
        icon={Code}
        title={title}
        closeLabel={t.library.close}
        onClose={onClose}
        actions={
          <EditorHeaderButton icon={RotateCcw} label={t.gradeLibrary.revert} onClick={() => setCode(initial)} />
        }
      />

      {/* ── Code: one scroller, three layers (sticky gutter · highlight · textarea). ── */}
      <div className="min-h-0 flex-1 overflow-auto bg-[#101014]">
        <div className="flex min-h-full w-max min-w-full">
          <div
            aria-hidden
            className="sticky left-0 z-10 w-11 shrink-0 border-r border-white/5 bg-[#131318] pr-2.5 text-right text-muted-foreground/35 select-none"
            style={{ ...CODE_STYLE, paddingTop: 12, paddingBottom: 12 }}
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <SyntaxHighlighter
              language="wgsl"
              style={oneDark}
              customStyle={{ ...CODE_STYLE, margin: 0, padding: "12px 14px", background: "transparent", overflow: "visible", whiteSpace: "pre" }}
              codeTagProps={{ style: CODE_STYLE }}
            >
              {/* Trailing newline keeps the last line's height when the caret sits on it. */}
              {code + "\n"}
            </SyntaxHighlighter>
            {/* overflow-hidden + box ≥ content ⇒ the textarea never scrolls itself */}
            <textarea
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                setResult(null)
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault()
                  void compile()
                }
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              className="absolute inset-0 resize-none overflow-hidden bg-transparent text-transparent outline-none selection:bg-blue-400/30"
              style={{ ...CODE_STYLE, caretColor: "#fafafa", padding: "12px 14px", whiteSpace: "pre" }}
            />
          </div>
        </div>
      </div>

      {/* One status row: errors (or the ok note) sit left of the Compile button. */}
      <div className="flex shrink-0 items-center gap-3 border-t border-white/10 px-3 py-2">
        {result && !result.ok && (
          <span
            className="min-w-0 flex-1 truncate text-[11px] text-red-400"
            title={result.diagnostics.join("\n")}
            style={{ fontFamily: CODE_FONT }}
          >
            {result.diagnostics[0]}
          </span>
        )}
        {result?.ok && (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground" style={{ fontFamily: CODE_FONT }}>
            {t.bgLibrary.appliedOk}
          </span>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() => void compile()}
          disabled={busy}
          title="⌘/Ctrl + Enter"
          className="h-7 bg-blue-400 px-3 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-50"
        >
          {t.bgLibrary.compile}
        </Button>
      </div>
    </div>
  )
}
