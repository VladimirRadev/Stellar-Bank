import { useEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type ReactNode } from 'react'
import { AlertIcon, CheckIcon, CloseIcon, ExternalIcon, InfoIcon } from './icons'

/**
 * Tiny toast system shared by all Stellar apps.
 *
 * - `toast({...})` can be called from anywhere (components, event handlers, plain functions).
 *   It appends one entry to a module-level list and notifies every mounted `ToastHost`.
 * - `ToastHost` renders that list. `Shell` mounts it once, so app code only calls `toast()`.
 * - At most 3 toasts are visible: adding a 4th drops the oldest one.
 * - Each toast closes itself after `durationMs` (default 12 s). The countdown pauses while the
 *   pointer is over the toast or keyboard focus is inside it, and continues where it stopped.
 */

export type ToastKind = 'success' | 'error' | 'info'

export type ToastOptions = {
  /** success: accent bar + check icon. error: danger bar + alert icon. info: neutral bar + info icon. */
  kind: ToastKind
  title: string
  body?: ReactNode
  /** Optional link under the body, opened in a new tab (for example a Blockscout tx page). */
  href?: string
  /** Text of the link. Default "Open". */
  hrefLabel?: string
  /** Short monospace detail next to the link, for example a truncated transaction hash. */
  detail?: string
  /** Auto-dismiss delay in milliseconds. Default 12 000. Pass 0 to keep the toast until it is closed. */
  durationMs?: number
}

type ToastEntry = ToastOptions & { id: number }

const MAX_TOASTS = 3
const DEFAULT_DURATION_MS = 12_000
const NO_TOASTS: readonly ToastEntry[] = []

let entries: readonly ToastEntry[] = NO_TOASTS
let nextId = 1
const listeners = new Set<() => void>()

function setEntries(next: readonly ToastEntry[]) {
  entries = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Shows a toast and returns its id (for `dismissToast`). */
// eslint-disable-next-line react/only-export-components -- the store lives next to its only renderer on purpose
export function toast(options: ToastOptions): number {
  const id = nextId++
  setEntries([...entries, { ...options, id }].slice(-MAX_TOASTS))
  return id
}

/** Closes one toast early. Unknown or already closed ids are ignored. */
// eslint-disable-next-line react/only-export-components -- see toast()
export function dismissToast(id: number): void {
  if (entries.some((e) => e.id === id)) setEntries(entries.filter((e) => e.id !== id))
}

/**
 * Fixed toast stack: bottom-right (24rem wide) from the `sm` breakpoint, bottom-center full width
 * with 16 px gutters on phones. Rendered once by Shell; the live region stays mounted while empty
 * so screen readers announce each new toast.
 */
export function ToastHost() {
  const items = useSyncExternalStore(subscribe, () => entries, () => NO_TOASTS)
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 mb-[env(safe-area-inset-bottom)] flex flex-col gap-3 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[24rem]"
    >
      {items.map((entry) => (
        <ToastCard key={entry.id} entry={entry} />
      ))}
    </div>
  )
}

const KIND_STYLE: Record<ToastKind, { bar: string; badge: string; Icon: typeof CheckIcon }> = {
  success: { bar: 'bg-accent', badge: 'bg-accent/15 text-accent-2', Icon: CheckIcon },
  error: { bar: 'bg-danger', badge: 'bg-danger/15 text-danger', Icon: AlertIcon },
  info: { bar: 'bg-muted/70', badge: 'bg-surface-2 text-muted', Icon: InfoIcon },
}

function ToastCard({ entry }: { entry: ToastEntry }) {
  const duration = entry.durationMs ?? DEFAULT_DURATION_MS
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remaining = useRef(duration)
  const paused = hovered || focused

  // Auto-dismiss. Pausing clears the timer and keeps the time that was left; resuming starts a
  // new timer for that remainder.
  useEffect(() => {
    if (duration <= 0 || paused) return
    const startedAt = Date.now()
    const timer = setTimeout(() => dismissToast(entry.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= Date.now() - startedAt
    }
  }, [duration, paused, entry.id])

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
  }

  const { bar, badge, Icon } = KIND_STYLE[entry.kind]

  return (
    <div
      className="pointer-events-auto relative overflow-hidden rounded-2xl border border-border bg-surface/90 py-3.5 pl-5 pr-2.5 shadow-[inset_0_1px_0_rgb(231_243_236/0.06),0_18px_48px_-14px_rgb(0_0_0/0.8)] backdrop-blur-xl motion-safe:animate-toast-in"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <div className="flex items-start gap-3">
        <span className={`mt-px grid size-7 shrink-0 place-items-center rounded-full ${badge}`}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="font-display text-[0.95rem] font-semibold leading-snug text-text">{entry.title}</p>
          {entry.body ? <div className="mt-1 break-words text-sm leading-relaxed text-muted">{entry.body}</div> : null}
          {entry.href || entry.detail ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {entry.href ? (
                <a className="link inline-flex items-center gap-1 font-medium" href={entry.href} target="_blank" rel="noreferrer">
                  {entry.hrefLabel ?? 'Open'} <ExternalIcon />
                </a>
              ) : null}
              {entry.detail ? <span className="font-mono text-xs text-muted">{entry.detail}</span> : null}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-text"
          onClick={() => dismissToast(entry.id)}
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  )
}
