import { useState } from 'react'
import { CheckIcon, CopyIcon } from './icons'

/** Small icon button that copies `value` to the clipboard and shows a check mark for 1.5 s. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2/60 text-muted transition hover:border-accent-2/50 hover:text-text"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1_500)
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
    >
      {copied ? <CheckIcon className="text-accent-2" /> : <CopyIcon />}
    </button>
  )
}
