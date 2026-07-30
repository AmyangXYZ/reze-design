"use client"

// The interactive parts of the admin page. Reads are server-rendered; only
// mutations need the client, and each one refreshes the server component
// afterwards so the table shows what the database says rather than a local guess.

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Ban, PenLine, RotateCcw, Trash2 } from "lucide-react"


function useAction() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const run = async (url: string, init: RequestInit) => {
    setBusy(true)
    const res = await fetch(url, init)
    setBusy(false)
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string }
      alert(error ?? "That didn't work.")
      return false
    }
    startTransition(() => router.refresh())
    return true
  }
  return { run, disabled: busy || pending }
}

const iconBtn = "flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors disabled:opacity-40"

// Moderation is deletion — by the author, or here by an admin. No visibility
// states to shepherd; published means public until someone removes it.
export function ItemControls({ id }: { id: string }) {
  const { run, disabled } = useAction()
  return (
    <div className="flex items-center gap-2">
      <button
        disabled={disabled}
        // Publishing is reversible; deleting is not.
        onClick={() => confirm("Delete this item permanently?") && void run(`/api/library/${id}`, { method: "DELETE" })}
        className={`${iconBtn} text-muted-foreground hover:bg-red-500/10 hover:text-red-400`}
        aria-label="Delete item"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

export function RenameUser({ id, username, isSelf }: { id: string; username: string | null; isSelf: boolean }) {
  const { run, disabled } = useAction()
  return (
    <button
      disabled={disabled}
      onClick={() => {
        const next = prompt("New handle (lowercase letters, digits, - and _):", username ?? "")
        if (!next || next === username) return
        void run(`/api/admin/users/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: next }),
        }).then((ok) => {
          // The signed-in session carries a cached copy of the handle, so renaming
          // YOURSELF leaves the account menu showing the old one until it reloads.
          if (ok && isSelf) window.location.reload()
        })
      }}
      className={`${iconBtn} text-muted-foreground hover:bg-white/5 hover:text-foreground`}
      aria-label="Rename handle"
    >
      <PenLine className="size-3.5" />
    </button>
  )
}

export function UserControls({ id, banned, isSelf }: { id: string; banned: boolean; isSelf: boolean }) {
  const { run, disabled } = useAction()
  // The API refuses these on your own account too; this just avoids offering them.
  if (isSelf) {
    return (
      <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-muted-foreground/60">you</span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={disabled}
        onClick={() => {
          if (banned) {
            void run(`/api/admin/users/${id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ banned: false }),
            })
            return
          }
          const reason = prompt("Reason for suspending this account? (optional)")
          if (reason === null) return
          void run(`/api/admin/users/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ banned: true, reason }),
          })
        }}
        className={`${iconBtn} ${banned ? "text-amber-400 hover:bg-amber-500/10" : "text-muted-foreground hover:bg-amber-500/10 hover:text-amber-400"}`}
        aria-label={banned ? "Lift suspension" : "Suspend account"}
      >
        {banned ? <RotateCcw className="size-3.5" /> : <Ban className="size-3.5" />}
      </button>
      <button
        disabled={disabled}
        onClick={() =>
          confirm("Delete this account? Their published items stay, with no owner.") &&
          void run(`/api/admin/users/${id}`, { method: "DELETE" })
        }
        className={`${iconBtn} text-muted-foreground hover:bg-red-500/10 hover:text-red-400`}
        aria-label="Delete account"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

type Asset = { key: string; size: number; modified: string | null }

const size = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

/** Fetched client-side: the bucket is a live listing, not something we mirror. */
export function AssetTable() {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () =>
    fetch("/api/admin/assets")
      .then((r) => r.json())
      .then((d: { objects?: Asset[]; truncated?: boolean }) => {
        setAssets(d.objects ?? [])
        setTruncated(d.truncated ?? false)
      })
      .catch(() => setAssets([]))

  useEffect(() => {
    void load()
  }, [])

  if (assets === null) return <p className="mt-3 text-xs text-muted-foreground">Loading…</p>
  if (assets.length === 0) return <p className="mt-3 text-xs text-muted-foreground">Nothing stored yet.</p>

  const total = assets.reduce((a, o) => a + o.size, 0)

  return (
    <>
      <p className="mt-1 text-xs text-muted-foreground">
        {assets.length} objects · {size(total)}
        {truncated && " · first 500 shown"}
      </p>
      <table className="mt-3 w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-white/10 text-left">
            <th className="py-2 font-medium">Key</th>
            <th className="py-2 font-medium">Size</th>
            <th className="py-2 font-medium">Modified (ET)</th>
            <th className="py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((o) => (
            <tr key={o.key} className="border-b border-white/5">
              <td className="max-w-md truncate py-2 pr-3 font-mono">{o.key}</td>
              <td className="py-2 pr-3 font-mono text-muted-foreground">{size(o.size)}</td>
              <td className="py-2 pr-3 font-mono text-muted-foreground">
                {o.modified
                  ? new Date(o.modified).toLocaleString("en-CA", {
                      timeZone: "America/New_York",
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })
                  : "—"}
              </td>
              <td className="py-2">
                <div className="flex">
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (!confirm(`Delete ${o.key}? Any scene referencing it will break.`)) return
                      setBusy(true)
                      await fetch("/api/admin/assets", {
                        method: "DELETE",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ key: o.key }),
                      })
                      await load()
                      setBusy(false)
                    }}
                    className={`${iconBtn} text-muted-foreground hover:bg-red-500/10 hover:text-red-400`}
                    aria-label="Delete object"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
