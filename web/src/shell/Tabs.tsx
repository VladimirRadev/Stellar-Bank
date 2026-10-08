/** Segmented tab control for in-page tab state (the suite has no router). */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly { key: T; label: string }[]
  value: T
  onChange: (key: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-2xl border border-border bg-surface/70 p-1">
      {tabs.map((tab) => {
        const active = tab.key === value
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`h-9 shrink-0 rounded-xl px-4 text-sm font-medium transition ${
              active ? 'bg-surface-2 text-text shadow-[inset_0_1px_0_rgb(231_243_236/0.08)]' : 'text-muted hover:text-text'
            }`}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
