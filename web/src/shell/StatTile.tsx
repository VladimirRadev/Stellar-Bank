import type { ReactNode } from 'react'

type StatTileProps = {
  label: string
  value: ReactNode
  unit?: string
  hint?: ReactNode
  loading?: boolean
  /** Highlights the value in the accent colour. */
  highlight?: boolean
}

/**
 * Small glass tile with an uppercase label and a large monospace value. On narrow tiles the label and
 * hint wrap and the unit drops below the value, so no text is cut off; only a value wider than the
 * whole tile is truncated.
 */
export function StatTile({ label, value, unit, hint, loading, highlight }: StatTileProps) {
  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <p className="eyebrow break-words">{label}</p>
      <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        {loading ? (
          <span className="skeleton h-7 w-24" />
        ) : (
          <span
            className={`max-w-full truncate font-mono text-xl font-semibold tabular-nums sm:text-2xl ${highlight ? 'text-accent-2' : 'text-text'}`}
          >
            {value}
          </span>
        )}
        {unit && !loading ? <span className="text-sm text-muted">{unit}</span> : null}
      </div>
      {hint ? <p className="mt-1 break-words text-xs text-muted">{hint}</p> : null}
    </div>
  )
}
