"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Cover } from "@/components/ui/cover"
import { Button } from "@/components/ui/button"

// ONE dialog at a time. Opening a dialog closes the one that is open — unless
// it was opened from inside that one (a "discard changes?" over its own form),
// which stacks on it instead, since closing the parent would lose the work.
// "From inside" is where the last press or the focus was: a mouse click drops
// focus (Button), so the press is the one that tells.
const openDialogs: { close: () => void; content: () => HTMLElement | null }[] = []
let lastPress: Element | null = null
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => (lastPress = e.target as Element), true)
}

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [inner, setInner] = React.useState(defaultOpen ?? false)
  const isOpen = open ?? inner
  const latest = React.useRef(onOpenChange)
  React.useEffect(() => {
    latest.current = onOpenChange
  })
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (open === undefined) setInner(next)
      latest.current?.(next)
    },
    [open],
  )
  const contentRef = React.useRef<HTMLElement | null>(null)
  React.useEffect(() => {
    if (!isOpen) return
    const me = { close: () => setOpen(false), content: () => contentRef.current }
    const from = [document.activeElement, lastPress]
    const top = openDialogs[openDialogs.length - 1]
    const nested = !!top && from.some((el) => el && top.content()?.contains(el))
    if (!nested) for (const d of openDialogs.splice(0)) d.close()
    openDialogs.push(me)
    return () => {
      const at = openDialogs.indexOf(me)
      if (at >= 0) openDialogs.splice(at, 1)
    }
  }, [isOpen, setOpen])
  return (
    <DialogContentRef.Provider value={contentRef}>
      <DialogPrimitive.Root data-slot="dialog" open={isOpen} onOpenChange={setOpen} {...props} />
    </DialogContentRef.Provider>
  )
}
const DialogContentRef = React.createContext<React.RefObject<HTMLElement | null> | null>(null)

/** Lays a dialog on the cover as PAPER (globals.css), growing out of the
 *  search box as the search palette does: its sheet, its frame, its motion,
 *  in the ink of the zone the box stands in. Where there is no box (the
 *  phone), the dialog keeps its own place. The box hides while paper is up
 *  and comes back once the last sheet has gone. */
function layPaper(el: HTMLElement) {
  const bar = document.querySelector<HTMLElement>("[data-search-bar]")
  const r = bar?.getBoundingClientRect()
  if (!bar || !r || r.width === 0) return false
  const zone = bar.closest<HTMLElement>("[data-ink]")
  el.dataset.paper = zone?.dataset.ink === "light" ? "dark" : "light"
  el.style.left = `${r.left}px`
  el.style.top = `${r.top}px`
  el.style.setProperty("--paper-w", `${r.width}px`)
  el.style.setProperty("--paper-h", `${r.height}px`)
  const root = document.documentElement
  root.dataset.paperUp = String(Number(root.dataset.paperUp ?? 0) + 1)
  return true
}
function liftPaper() {
  const root = document.documentElement
  const n = Number(root.dataset.paperUp ?? 0) - 1
  if (n > 0) root.dataset.paperUp = String(n)
  else delete root.dataset.paperUp
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeClassName,
  overlay = true,
  paper = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** Where the close button sits, for a dialog whose header is not the default
   *  p-6 — so the X lines up with that dialog's own title row. */
  closeClassName?: string
  /** Render the dimming backdrop. Set false for a non-modal, coexisting panel. */
  overlay?: boolean
  /** A small chooser on the cover: laid as paper out of the search box. */
  paper?: boolean
}) {
  const contentRef = React.useContext(DialogContentRef)
  const laid = React.useRef(false)
  // Stable, so React attaches it once per mount and not on every render.
  const attach = React.useCallback(
    (el: HTMLElement | null) => {
      if (contentRef) contentRef.current = el
      if (!paper) return
      if (el && !laid.current) laid.current = layPaper(el)
      else if (!el && laid.current) {
        laid.current = false
        liftPaper()
      }
    },
    [contentRef, paper],
  )
  return (
    <Cover on={false}>
      <DialogPortal data-slot="dialog-portal">
        {overlay && !paper && <DialogOverlay />}
        <DialogPrimitive.Content
          data-slot="dialog-content"
          ref={attach}
          className={cn(
            "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] compact:max-w-[calc(100%-1.5rem)] select-none translate-x-[-50%] translate-y-[-50%] gap-4 rounded-surface border bg-background p-6 shadow-float duration-233 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
            className,
            // As paper the sheet is its ground layer; the content sits on it.
            paper &&
              "data-[paper]:transition-none data-[paper]:w-[24rem] data-[paper]:max-w-[24rem] data-[paper]:translate-x-0 data-[paper]:translate-y-0 data-[paper]:gap-0 data-[paper]:overflow-hidden data-[paper]:border-0 data-[paper]:bg-transparent data-[paper]:p-0 data-[paper]:shadow-none",
          )}
          {...props}
        >
          {paper && (
            <div
              aria-hidden
              data-paper-ground
              className="absolute top-0 left-0 hidden size-full rounded-surface border border-line-strong bg-surface in-data-[paper]:block"
            />
          )}
          {paper ? (
            <div data-paper-content className="relative grid">
              {children}
            </div>
          ) : (
            children
          )}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className={cn(
                "absolute top-4 right-4 rounded-chip opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                closeClassName,
              )}
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Cover>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
