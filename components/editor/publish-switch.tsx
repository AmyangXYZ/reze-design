import type { LucideIcon } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useCover } from "@/components/ui/cover"
import { cn } from "@/lib/utils"

/**
 * A publish dialog's switches, as one strip: a well split into equal cells,
 * each a label beside its switch. Equal cells so the switches line up however
 * long their labels run; dividers so each pair reads as its own setting.
 * Stacked on a phone, where three side by side do not fit.
 */
export function PublishSwitches({ children }: { children: React.ReactNode }) {
  // On paper there is no well: the pairs stand as a line of type.
  const cover = useCover()
  if (cover) return <div className="flex flex-wrap items-center justify-between gap-x-4">{children}</div>
  return (
    // mt-1.5: a little more than the dialog's gap, since the strip has no label
    // above it and sat tight under the field before it. A label's full 18px
    // was too much: the strip read as a separate block.
    <div className="mt-1.5 grid auto-cols-fr divide-y divide-line rounded-interior border border-line-strong bg-white/5 sm:grid-flow-col sm:divide-x sm:divide-y-0">
      {children}
    </div>
  )
}


/** One cell of PublishSwitches. Inert, not hidden, while it does not apply, so
 *  the strip keeps its shape. */
export function PublishSwitch({
  icon: Icon,
  label,
  checked,
  onCheckedChange,
  disabled,
  widest,
}: {
  icon?: LucideIcon
  label: string
  /** Every word the label takes in turn: it is as wide as the widest, so the
   *  switch beside it does not move when the word changes. */
  widest?: string[]
  checked: boolean
  onCheckedChange: (on: boolean) => void
  disabled?: boolean
}) {
  // On paper the switch is the cover's drawn one, in the ink: no accent fill.
  const cover = useCover()
  return (
    <label
      className={cn("flex h-8 cursor-pointer items-center justify-center gap-2", !cover && "px-3", disabled && "pointer-events-none opacity-40")}
    >
      <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        {/* The icon lights in the selected blue while on, so the strip's state
            reads at a glance; on paper the words carry it, on one line. */}
        {Icon && !cover && <Icon className={cn("size-3.5 shrink-0", checked && "text-blue-400")} />}
        {widest ? (
          <span className="grid">
            <span className="col-start-1 row-start-1 truncate">{label}</span>
            {widest.map((w) => (
              <span key={w} aria-hidden className="invisible col-start-1 row-start-1">
                {w}
              </span>
            ))}
          </span>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </span>
      {/* The small switch, as the editor's own rows use: a full-size one in a
          strip this low reads as the loudest thing in the dialog. */}
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={
          cover
            ? undefined
            : cn(
                "data-[state=checked]:bg-blue-400",
                "[&_[data-slot=switch-thumb]]:data-[state=checked]:bg-white dark:[&_[data-slot=switch-thumb]]:data-[state=checked]:bg-white",
              )
        }
      />
    </label>
  )
}
