"use client"

// Language button for the left dock's icon rail

import { useState } from "react"
import { Check, Languages } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { LOCALES, LOCALE_LABELS, useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()
  // Controlled so picking a locale CLOSES the menu
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <PopoverTrigger asChild>
          <TooltipTrigger asChild>
            <button
              aria-label={t.brand.language}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
            >
              <Languages className="size-4" />
            </button>
          </TooltipTrigger>
        </PopoverTrigger>
        <TooltipContent side="right">{t.brand.language}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        // Closing returns focus to the trigger by default, and focus opens the TOOLTIP
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-36 rounded-xl border-white/10 bg-zinc-950/90 p-1 shadow-float backdrop-blur-xs"
      >
        {LOCALES.map((code) => (
          <button
            key={code}
            onClick={() => {
              setLocale(code)
              setOpen(false)
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-white/5",
              code === locale ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {LOCALE_LABELS[code]}
            {code === locale && <Check className="size-3.5 text-pink-400" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
