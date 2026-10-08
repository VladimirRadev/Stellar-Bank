// Small presentational pieces shared by the bank tabs.
import type { ReactNode } from 'react'
import { iVladTokenAbi } from '../abi'
import { addresses } from '../config/addresses'
import { formatToken } from '../shell/format'
import { TxButton } from '../shell/TxButton'
import { BANK_ERRORS, TONE_COLOR, TONE_TEXT, accrue, formatFixed, formatHf, hfTone, useNowMs, type Tone } from './bank'

/** A balance that keeps growing client-side with the contract's simple-interest formula. */
export function LiveAmount({
  principal,
  rateBps,
  since,
  digits = 6,
  interestOnly = false,
}: {
  principal: bigint | undefined
  rateBps: bigint | undefined
  since: bigint | undefined
  digits?: number
  /** Show only the interest accrued since `since`, not principal + interest. */
  interestOnly?: boolean
}) {
  const now = useNowMs(100)
  if (principal === undefined || since === undefined) return <>—</>
  const total = accrue(principal, rateBps, since, now)
  return <>{formatFixed(interestOnly ? total - principal : total, digits)}</>
}

/** Equal-width segmented switch; four options wrap to a 2 x 2 grid on phones. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { key: T; label: string }[]
  value: T
  onChange: (key: T) => void
  label: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`grid gap-1 rounded-2xl border border-border bg-bg/50 p-1 ${
        options.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
      }`}
    >
      {options.map((o) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className={`h-9 truncate rounded-xl px-2 text-sm font-medium transition ${
              active ? 'bg-surface-2 text-text shadow-[inset_0_1px_0_rgb(231_243_236/0.08)]' : 'text-muted hover:text-text'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Decimal amount field with a token label and an optional MAX button. */
export function AmountInput({
  id,
  label,
  value,
  onChange,
  symbol,
  onMax,
  maxActive,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  symbol: string
  onMax?: () => void
  maxActive?: boolean
  hint?: ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="shrink-0 text-sm text-muted">
          {label}
        </label>
        {hint ? <span className="min-w-0 truncate text-xs text-muted">{hint}</span> : null}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border bg-bg/60 p-1.5 pl-4 transition focus-within:border-accent-2/60">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(',', '.')
            if (/^\d*\.?\d*$/.test(v)) onChange(v)
          }}
          className="min-w-0 flex-1 bg-transparent font-mono text-lg tabular-nums text-text outline-none placeholder:text-muted/50"
        />
        <span className="shrink-0 text-sm font-medium text-muted">{symbol}</span>
        {onMax ? (
          <button
            type="button"
            onClick={onMax}
            className={`h-9 shrink-0 rounded-xl border px-3 font-mono text-xs font-semibold tracking-wider transition ${
              maxActive
                ? 'border-accent-2/60 bg-accent/15 text-accent-2'
                : 'border-border bg-surface-2/70 text-muted hover:border-accent-2/50 hover:text-text'
            }`}
          >
            MAX
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Label / value line used in the position cards. */
export function Line({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className={`min-w-0 truncate text-right font-mono tabular-nums ${tone ? TONE_TEXT[tone] : 'text-text'}`}>
        {children}
      </span>
    </div>
  )
}

/** Horizontal fill bar, 0..1. */
export function Meter({ fraction, tone = 'good' }: { fraction: number; tone?: Tone }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{
          width: `${pct}%`,
          background:
            tone === 'good' ? 'linear-gradient(90deg, #10b981, #34d399, #a3e635)' : `linear-gradient(90deg, ${TONE_COLOR[tone]}aa, ${TONE_COLOR[tone]})`,
        }}
      />
    </div>
  )
}

const ARC = 'M 16 100 A 84 84 0 0 1 184 100'
/** Semicircle health-factor gauge from 0 to 3; markers at 1.0 (liquidation) and 1.5 (comfort). */
export function HealthGauge({ hf, known }: { hf: bigint | undefined; known: boolean }) {
  const tone = hfTone(hf)
  // 100 path units per 1.0 of health factor; "no debt" fills the arc.
  const units = !known ? 0 : hf === undefined ? 300 : Math.min(300, Number(hf / 10n ** 16n))
  const tick = (u: number) => {
    const a = Math.PI - (u / 300) * Math.PI
    return { x1: 100 + 74 * Math.cos(a), y1: 100 - 74 * Math.sin(a), x2: 100 + 94 * Math.cos(a), y2: 100 - 94 * Math.sin(a) }
  }
  return (
    <figure className="relative mx-auto w-full max-w-[240px]" aria-label={`Health factor ${known ? formatHf(hf) : 'unknown'}`}>
      <svg viewBox="0 0 200 112" className="w-full overflow-visible">
        {[
          { from: 0, len: 100, color: TONE_COLOR.bad },
          { from: 100, len: 50, color: TONE_COLOR.warn },
          { from: 150, len: 150, color: TONE_COLOR.good },
        ].map((s) => (
          <path
            key={s.from}
            d={ARC}
            pathLength={300}
            fill="none"
            stroke={s.color}
            strokeOpacity={0.18}
            strokeWidth={12}
            strokeDasharray={`${s.len} 300`}
            strokeDashoffset={-s.from}
          />
        ))}
        <path
          d={ARC}
          pathLength={300}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${units} 300`}
          style={{ filter: `drop-shadow(0 0 6px ${TONE_COLOR[tone]}88)`, transition: 'stroke-dasharray 700ms ease' }}
        />
        {[100, 150].map((u) => (
          <line key={u} {...tick(u)} stroke="#8fa89b" strokeOpacity={0.6} strokeWidth={1.5} />
        ))}
      </svg>
      <figcaption className="absolute inset-x-0 bottom-0 text-center">
        <span className={`block font-mono text-3xl font-semibold tabular-nums ${known ? TONE_TEXT[tone] : 'text-muted'}`}>
          {known ? formatHf(hf) : '—'}
        </span>
        <span className="eyebrow">Health factor</span>
      </figcaption>
    </figure>
  )
}

/** Shows "Approve VLAD" while the allowance is below `need`, then the real action. */
export function ApproveThen({
  need,
  allowance,
  disabled,
  children,
}: {
  need: bigint | undefined
  allowance: bigint | undefined
  disabled?: boolean
  children: ReactNode
}) {
  if (need !== undefined && allowance !== undefined && allowance < need) {
    return (
      <div className="space-y-2">
        <TxButton
          request={{ address: addresses.vladToken, abi: iVladTokenAbi, functionName: 'approve', args: [addresses.bank, need] }}
          disabled={disabled}
          errorMessages={BANK_ERRORS}
          className="h-12 w-full"
        >
          Approve {formatToken(need)} VLAD
        </TxButton>
        <p className="text-xs text-muted">Step 1 of 2: let the bank pull this VLAD. Step 2 appears once it is confirmed.</p>
      </div>
    )
  }
  return <>{children}</>
}
