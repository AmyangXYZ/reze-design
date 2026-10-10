"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useNotice } from "@/lib/device"
import { useT } from "@/lib/i18n"

const HOME = "https://reze.design"

export function SiteNotice() {
  const t = useT()
  const due = useNotice()
  const [dismissed, setDismissed] = useState(false)
  // Every return to the app asks again.
  useEffect(() => {
    if (!due) return
    const onVisible = () => document.visibilityState === "visible" && setDismissed(false)
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [due])
  if (!due) return null
  return (
    <>
      <Dialog open={!dismissed} onOpenChange={(o) => !o && setDismissed(true)}>
        <DialogContent showCloseButton={false} className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">{t.notice.title}</DialogTitle>
            <DialogDescription className="text-xs">{t.notice.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
              {t.notice.dismiss}
            </Button>
            <Button asChild size="sm" className="bg-blue-400 text-white hover:bg-blue-400/90">
              <a href={HOME} target="_blank" rel="noreferrer">
                {t.notice.open}
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Badge label={t.notice.title} />
    </>
  )
}

function Badge({ label }: { label: string }) {
  useEffect(() => {
    let el: HTMLAnchorElement | null = null
    const ensure = () => {
      const style = el?.isConnected ? window.getComputedStyle(el) : null
      if (style && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") return
      el?.remove()
      el = document.createElement("a")
      el.href = HOME
      el.target = "_blank"
      el.rel = "noreferrer"
      el.textContent = `${label} · reze.design`
      el.className =
        "rounded-full border border-amber-400/30 bg-surface px-2 py-0.5 text-2xs text-amber-400 shadow-float backdrop-blur-xs"
      Object.assign(el.style, { position: "fixed", left: "12px", bottom: "64px", zIndex: "45", display: "block" })
      document.body.appendChild(el)
    }
    ensure()
    const id = window.setInterval(ensure, 1000)
    return () => {
      window.clearInterval(id)
      el?.remove()
    }
  }, [label])
  return null
}
