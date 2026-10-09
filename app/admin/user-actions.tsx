"use client"

// What an admin can do to an account or an item — each said plainly.
//
// Every action has a name that says what it does and a tooltip that says what
// follows from it, because "lift" and a ban icon left people guessing. Two
// forms: `labelled` buttons in the account panel, where there is room to say
// it, and icon buttons in a table row, where the tooltip says it. Both go
// through the same endpoints as before (api/admin/users, api/library).

import { Ban, PenLine, RotateCcw, Sparkle, Trash2, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { useAction } from "./actions"

const PATCH = (body: Record<string, unknown>): RequestInit => ({
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

/** The words for each action: what it is called, and what it does. */
export const ACTIONS = {
  grant: { label: "Grant Premium", tip: "Give this account Premium: the AI on this server's key, with its usage counted here." },
  remove: { label: "Remove Premium", tip: "Take Premium away. They keep everything they made; the AI then needs their own key." },
  suspend: { label: "Suspend account", tip: "They can't sign in and their maker page goes offline. What they published stays up. Reversible." },
  restore: { label: "Lift suspension", tip: "Let them sign in again and bring their maker page back." },
  rename: { label: "Change handle", tip: "Change their @handle. Their published items move to the new one; old links keep working." },
  remove_account: {
    label: "Delete account",
    tip: "Delete the account for good: sign-in, sessions and AI usage. What they published stays, with no owner. Not reversible.",
  },
  delete_item: { label: "Delete", tip: "Delete this item for good. Scenes that used it lose it. Not reversible." },
} as const

type Variant = "labelled" | "icon"

function ActionButton({
  variant,
  icon: Icon,
  label,
  tip,
  tone,
  disabled,
  onClick,
}: {
  variant: Variant
  icon: typeof Ban
  label: string
  tip: string
  tone?: "accent" | "warning" | "danger"
  disabled?: boolean
  onClick: () => void
}) {
  const toneClass =
    tone === "accent" ? "text-blue-600" : tone === "warning" ? "text-amber-600" : tone === "danger" ? "hover:text-red-600" : ""
  if (variant === "icon") {
    return (
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={disabled}
        onClick={onClick}
        tooltip={
          <span className="block max-w-56">
            <span className="font-medium">{label}</span> — {tip}
          </span>
        }
        aria-label={label}
        className={cn("text-muted-foreground hover:bg-accent hover:text-foreground", toneClass)}
      >
        <Icon className="size-3.5" />
      </Button>
    )
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      tooltip={<span className="block max-w-64">{tip}</span>}
      className={cn("h-8 justify-start gap-2 rounded-interior border border-line-strong px-3 text-[13px]", toneClass)}
    >
      <Icon className="size-3.5" />
      {label}
    </Button>
  )
}

/** Changes to your own account re-read the session past its cookie cache. */
function useAccount(id: string, isSelf: boolean) {
  const { run, disabled } = useAction()
  const patch = async (body: Record<string, unknown>) => {
    const ok = await run(`/api/admin/users/${id}`, PATCH(body))
    if (ok && isSelf) {
      await authClient.getSession({ query: { disableCookieCache: true } })
      window.location.reload()
    }
    return ok
  }
  return { run, patch, disabled }
}

export function PlanAction({ id, premium, isSelf, variant }: { id: string; premium: boolean; isSelf: boolean; variant: Variant }) {
  const { patch, disabled } = useAccount(id, isSelf)
  const a = premium ? ACTIONS.remove : ACTIONS.grant
  return (
    <ActionButton
      variant={variant}
      icon={Sparkle}
      label={a.label}
      tip={a.tip}
      tone={premium ? "accent" : undefined}
      disabled={disabled}
      onClick={() => confirm(`${a.label}?\n\n${a.tip}`) && void patch({ plan: premium ? "free" : "premium" })}
    />
  )
}

export function SuspendAction({ id, banned, isSelf, variant }: { id: string; banned: boolean; isSelf: boolean; variant: Variant }) {
  const { patch, disabled } = useAccount(id, isSelf)
  // The server refuses these on your own account; don't offer them.
  if (isSelf) return null
  const a = banned ? ACTIONS.restore : ACTIONS.suspend
  return (
    <ActionButton
      variant={variant}
      icon={banned ? RotateCcw : Ban}
      label={a.label}
      tip={a.tip}
      tone={banned ? "warning" : undefined}
      disabled={disabled}
      onClick={() => {
        if (banned) return void patch({ banned: false })
        const reason = prompt(`${a.label}\n\n${a.tip}\n\nReason (optional, shown only here):`)
        if (reason !== null) void patch({ banned: true, reason })
      }}
    />
  )
}

export function RenameAction({ id, username, isSelf, variant }: { id: string; username: string | null; isSelf: boolean; variant: Variant }) {
  const { run, disabled } = useAction()
  const a = ACTIONS.rename
  return (
    <ActionButton
      variant={variant}
      icon={PenLine}
      label={a.label}
      tip={a.tip}
      disabled={disabled}
      onClick={() => {
        const next = prompt("New handle (lowercase letters, digits, - and _):", username ?? "")
        if (!next || next === username) return
        void run(`/api/admin/users/${id}`, PATCH({ username: next })).then((ok) => {
          // Your own session caches the handle; reload to show the new one.
          if (ok && isSelf) window.location.reload()
        })
      }}
    />
  )
}

export function DeleteAccountAction({ id, isSelf, variant, onDone }: { id: string; isSelf: boolean; variant: Variant; onDone?: () => void }) {
  const { run, disabled } = useAction()
  if (isSelf) return null
  const a = ACTIONS.remove_account
  return (
    <ActionButton
      variant={variant}
      icon={UserX}
      label={a.label}
      tip={a.tip}
      tone="danger"
      disabled={disabled}
      onClick={() => confirm(`${a.label}?\n\n${a.tip}`) && void run(`/api/admin/users/${id}`, { method: "DELETE" }).then((ok) => ok && onDone?.())}
    />
  )
}

export function DeleteItemAction({ id, name, variant, onDone }: { id: string; name: string; variant: Variant; onDone: () => void }) {
  const { run, disabled } = useAction()
  const a = ACTIONS.delete_item
  return (
    <ActionButton
      variant={variant}
      icon={Trash2}
      label={a.label}
      tip={a.tip}
      tone="danger"
      disabled={disabled}
      onClick={() => confirm(`Delete "${name}"?\n\n${a.tip}`) && void run(`/api/library/${id}`, { method: "DELETE" }).then((ok) => ok && onDone())}
    />
  )
}
