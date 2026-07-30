// The material mark: a custom SVG drawn in lucide's language (24-grid, stroke-2,
// round caps) for the one place a lucide glyph had nothing close enough.

type IconProps = { className?: string }

export function MaterialSphereIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12V3.5A8.5 8.5 0 0 1 20.5 12Z" fill="currentColor" stroke="none" />
      <path d="M12 12v8.5A8.5 8.5 0 0 1 3.5 12Z" fill="currentColor" stroke="none" />
    </svg>
  )
}
