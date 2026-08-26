"use client"

// WGSL editor — a free-floating, draggable, resizable panel (FloatingPanel, the graph

import { memo, useCallback, useMemo, useRef, useState } from "react"
import { DIRECTIVE_LINE, DIRECTIVE_NOTE } from "reze-engine"
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

/**
 * One highlighted line.
 *
 * The whole document used to go through the highlighter on every keystroke —
 * Prism re-tokenising all of it, and React reconciling a <span> per token. At
 * 400 lines that is thousands of elements rebuilt per character: the editor
 * stalls, and a long session of it is a plausible way to lose the tab.
 *
 * Split per line and memoised, a keystroke re-tokenises the ONE line it touched;
 * the rest fail a string compare and are skipped. That keeps highlighting
 * synchronous, which is what matters — deferring it instead meant either the
 * text lagged behind the caret or it flashed from plain to coloured on every
 * edit, and the caret's own line is exactly the one you are looking at.
 *
 * The tokeniser sees one line at a time, so the ONE thing that carries state
 * across a newline has to be carried in: a block comment. `inBlock` says this
 * line began inside one, and a line that is still inside it is painted as a
 * comment without troubling Prism at all — cheaper than tokenising, and correct,
 * which the previous per-line-only version was not for a `/** … *\/` header.
 * Nothing else in WGSL spans lines: it has no multi-line strings.
 */
const COMMENT_COLOR = (oneDark['comment'] as { color?: string } | undefined)?.color ?? "#7f848e"
/** Directives are not WGSL, so Prism has nothing to say about them — and a line
 *  of configuration painted as plain text reads as the comment it used to be.
 *  The keyword colour says "this decides something". */
const DIRECTIVE_COLOR = (oneDark['keyword'] as { color?: string } | undefined)?.color ?? "#c678dd"

const HighlightedLine = memo(function HighlightedLine({ text, inBlock }: { text: string; inBlock: boolean }) {
  // A DIRECTIVE, painted before Prism ever sees it — the same shortcut the
  // block-comment branch below takes, and for the same reason: this is not WGSL
  // and tokenising it as WGSL would be both wasted and wrong.
  //
  // Three parts, because the split is information the author needs: the tag,
  // the ARGUMENTS the engine actually reads, and any note. Greying the note is
  // what shows where the arguments stop — an author who sees their bone name
  // greyed knows the engine is not going to read it.
  //
  // By the engine's own patterns, not a copy: a highlighter with its own idea
  // of what counts paints lines as configuration that the engine then ignores,
  // which is the exact confusion this syntax exists to end.
  const directive = !inBlock ? DIRECTIVE_LINE.exec(text) : null
  if (directive) {
    const [, tag, rest] = directive
    const lead = text.slice(0, text.indexOf("#"))
    const cut = rest.search(DIRECTIVE_NOTE)
    const args = cut >= 0 ? rest.slice(0, cut) : rest
    const note = cut >= 0 ? rest.slice(cut) : ""
    // The gap the tag's own trailing whitespace left, kept so nothing shifts.
    const gap = text.slice(lead.length + 1 + tag.length, text.length - rest.length)
    return (
      <div style={{ ...CODE_STYLE, whiteSpace: "pre", width: "max-content", minWidth: "100%" }}>
        {lead}
        <span style={{ color: DIRECTIVE_COLOR, fontWeight: 600 }}>{`#${tag}`}</span>
        {gap}
        {args}
        {note && <span style={{ color: COMMENT_COLOR }}>{note}</span>}
      </div>
    )
  }
  if (inBlock) {
    const end = text.indexOf("*/")
    // Still inside it: the whole line is comment.
    if (end === -1) {
      return (
        <div style={{ ...CODE_STYLE, color: COMMENT_COLOR, whiteSpace: "pre", width: "max-content", minWidth: "100%" }}>
          {text === "" ? " " : text}
        </div>
      )
    }
    // The line that closes it: comment up to and including the terminator, then
    // ordinary code — which is rare, but a `*/ let x = 1;` should not be grey.
    const head = text.slice(0, end + 2)
    const tail = text.slice(end + 2)
    return (
      <div style={{ ...CODE_STYLE, whiteSpace: "pre", width: "max-content", minWidth: "100%" }}>
        <span style={{ color: COMMENT_COLOR }}>{head}</span>
        {tail && <HighlightedLine text={tail} inBlock={false} />}
      </div>
    )
  }
  return (
    <SyntaxHighlighter
      language="wgsl"
      style={oneDark}
      PreTag="div"
      customStyle={{
        ...CODE_STYLE,
        margin: 0,
        padding: 0,
        background: "transparent",
        overflow: "visible",
        whiteSpace: "pre",
        // max-content so the widest line sets the scroll width; 100% so a short
        // one still fills the column rather than collapsing.
        width: "max-content",
        minWidth: "100%",
      }}
      codeTagProps={{ style: CODE_STYLE }}
    >
      {/* A space, not "", so an empty line keeps its height and stays in step
          with the gutter beside it. */}
      {text === "" ? " " : text}
    </SyntaxHighlighter>
  )
})

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
  // Split once per edit and handed to memoised lines, so the cost of a keystroke
  // is one line's worth of highlighting rather than the document's.
  const lines = useMemo(() => code.split("\n"), [code])
  const lineCount = lines.length
  /**
   * Which lines BEGIN inside a block comment.
   *
   * One scan of the text per edit, which is nothing next to tokenising — the
   * expensive part was always Prism plus React reconciling a span per token, and
   * this feeds the memo so a line whose flag did not change is still skipped.
   *
   * `//` wins when it comes first on a line, so a commented-out `// /*` does not
   * open a block that never closes.
   */
  const blockAt = useMemo(() => {
    const flags: boolean[] = []
    let open = false
    for (const line of lines) {
      flags.push(open)
      let i = 0
      while (i < line.length) {
        if (open) {
          const end = line.indexOf("*/", i)
          if (end === -1) break
          open = false
          i = end + 2
        } else {
          const start = line.indexOf("/*", i)
          const lineComment = line.indexOf("//", i)
          if (start === -1) break
          if (lineComment !== -1 && lineComment < start) break
          open = true
          i = start + 2
        }
      }
    }
    return flags
  }, [lines])

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
            <div aria-hidden style={{ padding: "12px 14px" }}>
              {lines.map((line, i) => (
                <HighlightedLine key={i} text={line} inBlock={blockAt[i]} />
              ))}
            </div>
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
              // select-text: a code editor selects, whatever the surface around
              // it says. The dialog turns selection off so labels cannot be
              // dragged into a highlight by accident; this is the exception.
              className="absolute inset-0 resize-none overflow-hidden bg-transparent text-transparent outline-none select-text selection:bg-blue-400/30"
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
            {t.effectLibrary.appliedOk}
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
          {t.effectLibrary.compile}
        </Button>
      </div>
    </div>
  )
}
