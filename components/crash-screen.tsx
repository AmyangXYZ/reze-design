"use client"

// The page that replaces the page when a render throws.
//
// Two jobs, in this order: get the user moving again, and make the failure
// reportable. The second one is why this is more than an apology — a crash on
// someone else's machine is only ever as debuggable as what they can hand over,
// and "it said it couldn't load" is not that. So the report is assembled here,
// shown in full before it is sent anywhere, and copyable in one press.
//
// Deliberately self-contained: no i18n provider (global-error replaces the root
// layout, so no provider is mounted), no Radix, no engine. Everything it imports
// is a candidate for the thing that just broke.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { buildReport, collectStorage, type StorageSnapshot } from "@/lib/crash-log"
import { cn } from "@/lib/utils"

const ISSUES_URL = "https://github.com/AmyangXYZ/reze-design/issues/new"
/** GitHub truncates a long prefilled URL; the copy button carries the whole thing. */
const PREFILL_LIMIT = 4000

const COPY = {
  en: {
    title: "Something broke",
    blurb: "The editor stopped rendering. Your saved scene is untouched — reloading usually brings it back.",
    retry: "Try again",
    reload: "Reload",
    copy: "Copy report",
    copied: "Copied",
    details: "Show details",
    hide: "Hide details",
    report: "Open an issue",
    reportHint: "Copy the report first — paste it into the issue.",
    resetTitle: "Still broken after a reload?",
    resetBlurb:
      "Clear the scene this browser has saved and start from the default one. Published scenes and anything you have shared are not affected.",
    reset: "Clear saved scene",
    confirm: "Clear it — this cannot be undone",
    cancel: "Cancel",
    clearing: "Clearing…",
  },
  zh: {
    title: "出错了",
    blurb: "编辑器渲染中断。已保存的场景没有受到影响，刷新通常就能恢复。",
    retry: "重试",
    reload: "刷新",
    copy: "复制报告",
    copied: "已复制",
    details: "查看详情",
    hide: "收起详情",
    report: "提交问题",
    reportHint: "请先复制报告，再粘贴到问题里。",
    resetTitle: "刷新后仍然打不开？",
    resetBlurb: "清除浏览器保存的本地场景，从默认场景重新开始。已发布和已分享的场景不受影响。",
    reset: "清除本地场景",
    confirm: "确认清除——无法撤销",
    cancel: "取消",
    clearing: "清除中…",
  },
}

/**
 * The locale, read the way i18n reads it — without mounting i18n.
 *
 * Through useSyncExternalStore rather than an effect, because the source is
 * outside React and unavailable while rendering on the server: the server
 * snapshot is "en", the client's is whatever the browser says, and React
 * reconciles the two instead of the page flashing through a state update.
 */
const NEVER_CHANGES = () => () => {}
const readLocale = (): "en" | "zh" => {
  try {
    const saved = window.localStorage.getItem("reze-design.locale")
    if (saved === "zh" || saved === "en") return saved
  } catch {
    // private mode — fall through to the browser's language
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"
}
function useCrashLocale(): "en" | "zh" {
  return useSyncExternalStore(NEVER_CHANGES, readLocale, () => "en")
}

/** Everything a reload reads back. Cleared together or not at all — a half-cleared
 *  scene (state without its assets) boots into exactly the confusion this escapes. */
const SCENE_KEYS = ["reze-design.sceneState.3", "reze-design.sceneAssets.1", "reze-design.fork"]

export function CrashScreen({
  error,
  retry,
}: {
  error?: (Error & { digest?: string }) | null
  /** Re-render the boundary's children. Absent where retrying cannot help. */
  retry?: () => void
}) {
  const locale = useCrashLocale()
  const t = COPY[locale]
  const [storage, setStorage] = useState<StorageSnapshot | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    // Into the console too: a reporter who opens devtools instead of pressing
    // copy should find the same thing, not a blank log behind a polite page.
    if (error) console.error("[reze] render crashed:", error)
    void collectStorage().then(setStorage)
  }, [error])

  const report = buildReport(error ?? null, storage)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure origin, denied permission): open the details
      // so the text is at least selectable by hand.
      setOpen(true)
    }
  }, [report])

  const clearScene = useCallback(async () => {
    setClearing(true)
    for (const key of SCENE_KEYS) {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // nothing to do — the reload below is still worth attempting
      }
    }
    try {
      const { clearLocalBundle } = await import("@/lib/asset-store")
      await clearLocalBundle()
    } catch {
      // the doc pointing at it is already gone, which is what boot reads
    }
    window.location.reload()
  }, [])

  return (
    <div className="min-h-dvh w-full flex items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-2xl rounded-surface border border-line-strong bg-surface-raised p-6">
        <h1 className="text-base font-medium">{t.title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t.blurb}</p>

        {error && (
          <p className="mt-4 rounded-interior border border-line bg-surface px-3 py-2 font-mono text-xs break-words">
            {error.message || error.name}
            {error.digest && <span className="text-muted-foreground"> · {error.digest}</span>}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {retry && (
            <Button size="sm" onClick={retry}>
              {t.retry}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            {t.reload}
          </Button>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? t.copied : t.copy}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? t.hide : t.details}
          </Button>
        </div>

        {open && (
          <pre className="mt-3 max-h-72 overflow-auto rounded-interior border border-line bg-surface p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground select-text">
            {report}
          </pre>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <a
            href={`${ISSUES_URL}?title=${encodeURIComponent(
              `Crash: ${error?.message ?? "page failed to load"}`,
            )}&body=${encodeURIComponent("```\n" + report.slice(0, PREFILL_LIMIT) + "\n```")}`}
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 underline-offset-4 hover:underline"
          >
            {t.report}
          </a>
          <span>{t.reportHint}</span>
        </div>

        <div className="mt-6 border-t border-line pt-4">
          <h2 className="text-sm font-medium">{t.resetTitle}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t.resetBlurb}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={clearing}
                  onClick={clearScene}
                  className={cn("text-red-400 hover:text-red-400", clearing && "opacity-70")}
                >
                  {clearing ? t.clearing : t.confirm}
                </Button>
                <Button size="sm" variant="ghost" disabled={clearing} onClick={() => setConfirming(false)}>
                  {t.cancel}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" className="text-red-400" onClick={() => setConfirming(true)}>
                {t.reset}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
