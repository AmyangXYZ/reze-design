"use client"

// WGSL editor — a free-floating, draggable, resizable panel (FloatingPanel, the graph

import { useCallback, useMemo, useState } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { ArrowDownToLine, Check, Code, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EditorHeader, EditorHeaderButton } from "@/components/editor/editor-header"
import { FloatingPanel, type Rect } from "@/components/editor/floating-panel"
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
  onClose: () => void
}) {
  if (!open || !rect) return null
  return (
    <FloatingPanel
      rect={rect}
      onRectChange={onRectChange}
      open={open}
      fullscreen={false}
      raiseKey={sessionId}
      minW={420}
      minH={280}
      // z-50 like the graph editor
      className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 shadow-float"
    >
      <EditorBody key={sessionId} title={title} initial={initial} onCompile={onCompile} onClose={onClose} />
    </FloatingPanel>
  )
}

function EditorBody({
  title,
  initial,
  onCompile,
  onClose,
}: {
  title: string
  initial: string
  onCompile: (wgsl: string) => Promise<WgslCompileResult>
  onClose: () => void
}) {
  const t = useT()
  const [code, setCode] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
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

  return (
    <div className="flex h-full flex-col">
      <EditorHeader
        icon={Code}
        title={`${title} · WGSL`}
        closeLabel={t.library.close}
        onClose={onClose}
        actions={
          <>
            <EditorHeaderButton
              icon={copied ? Check : Copy}
              label={t.bgLibrary.copy}
              onClick={() => {
                void navigator.clipboard.writeText(code).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            />
            <EditorHeaderButton
              icon={ArrowDownToLine}
              label={t.bgLibrary.download}
              onClick={() => {
                const a = document.createElement("a")
                a.href = URL.createObjectURL(new Blob([code], { type: "text/plain" }))
                a.download = `${title.replace(/[^\w一-鿿-]+/g, "_")}.wgsl`
                a.click()
                URL.revokeObjectURL(a.href)
              }}
            />
          </>
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

      {/* ── Diagnostics — only after a failed compile. ── */}
      {result && !result.ok && (
        <div className="max-h-28 shrink-0 overflow-y-auto border-t border-red-400/20 bg-red-950/20 px-4 py-2">
          {result.diagnostics.map((d, i) => (
            <div key={i} className="text-xs leading-relaxed text-red-400" style={{ fontFamily: CODE_FONT }}>
              {d}
            </div>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-3 border-t border-white/10 px-3 py-2">
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
