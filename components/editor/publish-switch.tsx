import type { LucideIcon } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

/**
 * A publish dialog's switches, as one strip: a well split into equal cells,
 * each a label beside its switch. Equal cells so the switches line up however
 * long their labels run; dividers so each pair reads as its own setting.
 * Stacked on a phone, where three side by side do not fit.
 */
export function PublishSwitches({ children }: { children: React.ReactNode }) {
  return (
    // mt-1.5: a little more than the dialog's gap, since the strip has no label
    // above it and sat tight under the field before it. A label's full 18px
    // was too much: the strip read as a separate block.
    <div className="mt-1.5 grid auto-cols-fr divide-y divide-line rounded-interior border border-line-strong bg-white/5 sm:grid-flow-col sm:divide-x sm:divide-y-0">
      {children}
    </div>
  )
}

const TONE = {
  blue: "data-[state=checked]:bg-blue-400",
  amber: "data-[state=checked]:bg-amber-400",
} as const
const ICON_TONE = { blue: "text-blue-400", amber: "text-amber-400" } as const

/** One cell of PublishSwitches. Inert, not hidden, while it does not apply, so
 *  the strip keeps its shape. */
export function PublishSwitch({
  icon: Icon,
  label,
  checked,
  onCheckedChange,
  disabled,
  title,
  tone = "blue",
}: {
  icon?: LucideIcon
  label: string
  checked: boolean
  onCheckedChange: (on: boolean) => void
  disabled?: boolean
  title?: string
  /** The accent it lights in when on, by the chrome's meanings: blue for an
   *  active choice, amber for one that works but asks to be read (18+). */
  tone?: "blue" | "amber"
}) {
  return (
    <label
      title={title}
      className={cn("flex h-8 cursor-pointer items-center justify-center gap-2 px-3", disabled && "pointer-events-none opacity-40")}
    >
      <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        {/* The icon lights in the switch's accent while on, so the strip's
            state reads at a glance; off, it is muted with its label. */}
        {Icon && <Icon className={cn("size-3.5 shrink-0", checked && ICON_TONE[tone])} />}
        <span className="truncate">{label}</span>
      </span>
      {/* The small switch, as the editor's own rows use: a full-size one in a
          strip this low reads as the loudest thing in the dialog. */}
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          TONE[tone],
          "[&_[data-slot=switch-thumb]]:data-[state=checked]:bg-white dark:[&_[data-slot=switch-thumb]]:data-[state=checked]:bg-white",
        )}
      />
    </label>
  )
}
