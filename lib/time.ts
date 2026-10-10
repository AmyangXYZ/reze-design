// Dates as the person reading them lives them: their own timezone, always.

const pad = (n: number) => String(n).padStart(2, "0")

const parse = (iso: string): Date | null => {
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? null : d
}

/** `2026-10-09`, in the local zone. */
function localDay(iso: string): string {
  const d = parse(iso)
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "—"
}

/** `2026-10-09 17:02`, in the local zone. */
export function localMinute(iso: string): string {
  const d = parse(iso)
  return d ? `${localDay(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "—"
}

/** `Oct 9, 2026, 17:02`, in the reader's language, on a 24-hour clock. */
export function wordedMinute(iso: string, locale?: string): string {
  const d = parse(iso)
  return d ? d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }) : "—"
}
