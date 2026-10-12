import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { erc20Abi, type Abi, type Address } from 'viem'
import { useConnection, useReadContract } from 'wagmi'
import { CHAIN_ID, addresses } from '../config/addresses'
import { formatToken, isConfiguredAddress, textOf } from './format'
import { CheckIcon } from './icons'
import { TxButton } from './TxButton'

export type ApproveThenProps = {
  /** ERC-20 token that `spender` pulls. Default: addresses.vladToken. */
  token?: Address
  /** Token symbol for labels and the success toast. Default 'VLAD'. */
  tokenSymbol?: string
  /**
   * ABI used for allowance() and approve(). Default: viem's standard erc20Abi.
   * Common ERC-20 errors are decoded anyway: TxButton merges COMMON_ERRORS_ABI into every simulation.
   */
  tokenAbi?: Abi
  spender: Address
  /** Readable spender name for the toast and the hint, for example 'the Store'. */
  spenderName: string
  /** Allowance the action needs, in base units (18 decimals). 0n: nothing to approve, children render directly. */
  amount: bigint
  /**
   * Allowance the approve step grants, in base units. Must be >= `amount` (a smaller value is raised
   * to `amount`). Default `amount`. Pass a multiple to cover several actions with one approval, for
   * example the entry fee x 10. Step 2 still opens as soon as the allowance covers `amount`.
   */
  approveAmount?: bigint
  /** Labels of the two steps. Default: ['Approve {tokenSymbol}', text of `children`]. */
  stepLabels?: [string, string]
  /** Disables the approve button (the action button in `children` handles its own disabled state). */
  disabled?: boolean
  /** Step 2: the action, normally a TxButton. */
  children: ReactNode
}

/**
 * After a confirmed approve, step 2 shows at once, even if the RPC still serves the old allowance.
 * This "optimistic" approval ends as soon as the allowance read catches up (from then on the read
 * decides, so a later spend that uses up the allowance brings step 1 back), or after this many ms
 * as a safety net. The tracker's last post-receipt refresh runs at most ~28 s after the receipt.
 */
const OPTIMISTIC_MAX_MS = 30_000

/** `amount` is the allowance that was approved (`approveAmount`). */
type Optimistic = { key: string; amount: bigint; until: number }

/**
 * Shared approve-then-act flow. Reads allowance(owner, spender) on Sepolia and shows a two-step
 * track. Step 1 is an approve TxButton for `approveAmount` (default: exactly `amount`); once it is
 * confirmed (or the allowance already covers `amount`) the track checks step 1 and `children` (step 2)
 * render instead.
 * While the first allowance read loads, a skeleton holds the place, so the wrong step never flashes.
 * Renders `children` directly when no wallet is connected, when `amount` is 0n, or when the token or
 * spender address is a not-deployed placeholder.
 */
export function ApproveThen({
  token = addresses.vladToken,
  tokenSymbol = 'VLAD',
  tokenAbi = erc20Abi,
  spender,
  spenderName,
  amount,
  approveAmount,
  stepLabels,
  disabled,
  children,
}: ApproveThenProps) {
  const { address: owner } = useConnection()
  const active = !!owner && amount > 0n && isConfiguredAddress(token) && isConfiguredAddress(spender)

  const read = useReadContract({
    address: token,
    abi: tokenAbi,
    functionName: 'allowance',
    args: owner ? [owner, spender] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: active },
  })
  const allowance = typeof read.data === 'bigint' ? read.data : undefined

  const key = `${token}|${owner ?? ''}|${spender}`.toLowerCase()
  const [optimistic, setOptimistic] = useState<Optimistic>()
  const optimisticCovers = !!optimistic && optimistic.key === key && optimistic.amount >= amount

  // The read has caught up with the approval: from now on it decides. (Reset during render, React's
  // documented pattern for state that depends on new data; it re-renders once, before painting.)
  if (optimistic && allowance !== undefined && allowance >= optimistic.amount) setOptimistic(undefined)

  useEffect(() => {
    if (!optimistic) return
    const timer = setTimeout(() => setOptimistic(undefined), Math.max(0, optimistic.until - Date.now()))
    return () => clearTimeout(timer)
  }, [optimistic])

  if (!active) return <>{children}</>

  const approved = optimisticCovers || (allowance !== undefined && allowance >= amount)
  const toApprove = approveAmount !== undefined && approveAmount > amount ? approveAmount : amount
  const amountLabel = `${formatToken(amount)} ${tokenSymbol}`
  const approveLabel = `${formatToken(toApprove)} ${tokenSymbol}`
  /** How many more actions of `amount` the approval covers after this one. */
  const extraRuns = toApprove / amount - 1n
  const [firstLabel, secondLabel] = stepLabels ?? [`Approve ${tokenSymbol}`, textOf(children).trim() || 'Confirm']

  if (read.isLoading && !approved) {
    return (
      <div className="space-y-3" aria-busy>
        <span className="skeleton block h-5 w-full" />
        <span className="skeleton block h-11 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <StepTrack approved={approved} labels={[firstLabel, secondLabel]} />
      {approved ? (
        // Keyed so React never reuses the approve TxButton's state (hash, status line) for a TxButton in children.
        <Fragment key="action">{children}</Fragment>
      ) : (
        <Fragment key="approve">
          <TxButton
            request={{ address: token, abi: tokenAbi, functionName: 'approve', args: [spender, toApprove] }}
            disabled={disabled}
            className="w-full"
            onConfirmed={() => setOptimistic({ key, amount: toApprove, until: Date.now() + OPTIMISTIC_MAX_MS })}
            successMessage={`Approved ${approveLabel} for ${spenderName}. Step 2 is ready.`}
          >
            Approve {approveLabel}
          </TxButton>
          <p className="text-xs leading-relaxed text-muted">
            {toApprove === amount
              ? `Step 1 of 2 lets ${spenderName} spend exactly ${amountLabel} from your wallet.`
              : `Step 1 of 2 lets ${spenderName} spend up to ${approveLabel} from your wallet. This action uses ${amountLabel}${
                  extraRuns > 0n ? `, so the approval also covers the next ${extraRuns.toString()}` : ''
                }.`}{' '}
            Step 2 opens as soon as it is mined.
          </p>
        </Fragment>
      )}
    </div>
  )
}

function StepTrack({ approved, labels }: { approved: boolean; labels: [string, string] }) {
  const dot = 'grid size-5 shrink-0 place-items-center rounded-full text-[0.65rem] font-semibold'
  return (
    <ol className="flex min-w-0 items-center gap-2 text-xs" aria-label="Approval steps">
      <li
        className={`inline-flex min-w-0 items-center gap-1.5 ${approved ? 'text-accent-2' : 'text-text'}`}
        aria-current={approved ? undefined : 'step'}
      >
        <span className={`${dot} ${approved ? 'bg-accent/20' : 'bg-accent text-bg'}`}>
          {approved ? <CheckIcon size={12} /> : '1'}
        </span>
        <span className="truncate">
          {labels[0]}
          {approved ? <span className="sr-only"> (done)</span> : null}
        </span>
      </li>
      <li aria-hidden className="h-px min-w-4 flex-1 bg-border" />
      <li
        className={`inline-flex min-w-0 items-center gap-1.5 ${approved ? 'text-text' : 'text-muted'}`}
        aria-current={approved ? 'step' : undefined}
      >
        <span className={`${dot} ${approved ? 'bg-accent text-bg' : 'border border-border'}`}>2</span>
        <span className="truncate">{labels[1]}</span>
      </li>
    </ol>
  )
}
