// Custom SVGs drawn in lucide's language (24-grid, stroke-2, round caps) for the
// places a lucide glyph had nothing close enough — plus the one brand mark,
// which lucide dropped along with the rest of its brand set.

type IconProps = { className?: string }

/** GitHub's Octocat mark. A brand is drawn the way its owner draws it — filled,
 *  not a stroked approximation — so it reads as the same logo people already
 *  know rather than an icon that resembles it. */
export function GithubMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.55v-2.16c-3.2.62-3.88-1.37-3.88-1.37-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.35.78 1.05.78 2.12v3.14c0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}

export function MaterialSphereIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12V3.5A8.5 8.5 0 0 1 20.5 12Z" fill="currentColor" stroke="none" />
      <path d="M12 12v8.5A8.5 8.5 0 0 1 3.5 12Z" fill="currentColor" stroke="none" />
    </svg>
  )
}
