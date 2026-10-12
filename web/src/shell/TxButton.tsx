import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Abi, Address, Hash } from 'viem'
import { useConnection, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CHAIN_ID } from '../config/addresses'
import { COMMON_ERRORS_ABI, describeError, type ErrorMessages } from './errors'
import { explorerTxUrl, truncateAddress } from './format'
import { CheckIcon, ExternalIcon, Spinner } from './icons'
import { toast } from './Toast'

/** A contract write, described the same way as for wagmi's writeContract. */
export type TxRequest = {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}

type TxButtonProps = {
  request: TxRequest
  children: ReactNode
  disabled?: boolean
  className?: string
  /** Extra readable messages for this app's custom errors (merged over the defaults). */
  errorMessages?: ErrorMessages
  /** Called once, right when the receipt says success (before balances are refreshed). Use it to advance steps. */
  onConfirmed?: (hash: Hash) => void
  /**
   * Body of the "Transaction confirmed" toast, with concrete amounts, for example
   * "Claimed 100 VLAD. Next claim in 6h.". A function receives the transaction hash.
   * Every TxButton that moves funds must pass one.
   */
  successMessage?: ReactNode | ((hash: Hash) => ReactNode)
}

/** How often the chain head is polled after a receipt, and how long before refreshing anyway. */
const HEAD_POLL_MS = 1_500
const HEAD_TIMEOUT_MS = 20_000
/** Extra refreshes after the first one, for RPC nodes behind a load balancer that lag behind the head. */
const FOLLOW_UP_REFRESH_MS = [3_000, 8_000] as const

/**
 * Refreshes every cached read after a mined transaction, in a way that survives lagging RPC nodes:
 * 1. polls the head block number every HEAD_POLL_MS until it reaches `blockNumber`
 *    (or HEAD_TIMEOUT_MS passes), so the first refetch does not read pre-transaction state;
 * 2. calls `refresh` and, once that first refetch has settled, `onRefreshed`;
 * 3. calls `refresh` again 3 s and 8 s later, because the next request may hit a different node.
 * Returns a function that cancels whatever has not run yet.
 */
function syncAfterReceipt(opts: {
  blockNumber: bigint
  readHead: () => Promise<bigint>
  refresh: () => Promise<void>
  onRefreshed: () => void
}): () => void {
  let cancelled = false
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (!cancelled) run()
    }, ms)
    timers.add(timer)
  }
  const deadline = Date.now() + HEAD_TIMEOUT_MS

  const refreshAll = () => {
    for (const ms of FOLLOW_UP_REFRESH_MS) later(ms, () => void opts.refresh().catch(() => {}))
    void opts
      .refresh()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) opts.onRefreshed()
      })
  }

  const pollHead = async () => {
    let head: bigint | undefined
    try {
      head = await opts.readHead()
    } catch {
      // A failed head read is retried on the next tick.
    }
    if (cancelled) return
    if ((head !== undefined && head >= opts.blockNumber) || Date.now() >= deadline) refreshAll()
    else later(HEAD_POLL_MS, () => void pollHead())
  }

  void pollHead()
  return () => {
    cancelled = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  }
}

/**
 * One button for one contract write:
 * 1. simulates the call against the public RPC (custom errors are decoded before the wallet opens),
 * 2. asks the wallet to sign and send,
 * 3. waits for the receipt, then calls `onConfirmed` and shows a toast ("Transaction confirmed"
 *    with `successMessage`, or "Transaction reverted"), both with a Blockscout link,
 * 4. refreshes every cached query once the RPC has caught up with the receipt's block, plus two
 *    follow-up refreshes (see syncAfterReceipt). The inline status line shows each phase.
 * Wallet rejections and simulation errors stay inline under the button; they are never toasted.
 *
 * The refresh schedule keeps running if the button unmounts (a parent often swaps it out from
 * `onConfirmed`, for example ApproveThen), because the refreshes only touch the global query
 * cache; it ends by itself at most ~30 s after the receipt. When the next transaction from the same
 * button is mined, its schedule replaces the previous one (a rejected or failed send cancels nothing).
 */
export function TxButton({
  request,
  children,
  disabled,
  className = '',
  errorMessages,
  onConfirmed,
  successMessage,
}: TxButtonProps) {
  const { address } = useConnection()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()
  const write = useWriteContract()

  const [hash, setHash] = useState<Hash>()
  const [simulating, setSimulating] = useState(false)
  const [error, setError] = useState<string>()
  /** Hash whose first post-receipt refresh has finished. */
  const [refreshedHash, setRefreshedHash] = useState<Hash>()

  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID, query: { enabled: !!hash } })

  const cancelSync = useRef<(() => void) | undefined>(undefined)
  const handled = useRef<Hash | undefined>(undefined)
  useEffect(() => {
    const r = receipt.data
    if (!r || handled.current === r.transactionHash) return
    const txHash = r.transactionHash
    handled.current = txHash
    const link = { href: explorerTxUrl(txHash), hrefLabel: 'View on Blockscout', detail: truncateAddress(txHash, 10, 8) }

    if (r.status === 'success') {
      onConfirmed?.(txHash)
      toast({
        kind: 'success',
        title: 'Transaction confirmed',
        body: typeof successMessage === 'function' ? successMessage(txHash) : successMessage,
        ...link,
      })
    } else {
      toast({
        kind: 'error',
        title: 'Transaction reverted',
        body: `Mined in block ${r.blockNumber.toString()} but reverted: nothing changed except the gas fee.`,
        ...link,
      })
    }

    cancelSync.current?.()
    cancelSync.current = syncAfterReceipt({
      blockNumber: r.blockNumber,
      // cacheTime 0: viem otherwise reuses a block number up to 4 s old.
      readHead: publicClient ? () => publicClient.getBlockNumber({ cacheTime: 0 }) : async () => r.blockNumber,
      refresh: () => queryClient.invalidateQueries(),
      onRefreshed: () => setRefreshedHash(txHash),
    })
  }, [receipt.data, queryClient, publicClient, onConfirmed, successMessage])

  const signing = write.isPending
  const mining = !!hash && receipt.isLoading
  const busy = simulating || signing || mining
  const reverted = receipt.data?.status === 'reverted'
  const confirmed = receipt.data?.status === 'success'
  const refreshed = !!hash && refreshedHash === hash
  const receiptError = receipt.error ? describeError(receipt.error) : undefined

  async function send() {
    if (!address || !publicClient) return
    setError(undefined)
    setHash(undefined)
    try {
      setSimulating(true)
      await publicClient.simulateContract({
        address: request.address,
        abi: [...request.abi, ...COMMON_ERRORS_ABI] as Abi,
        functionName: request.functionName,
        args: request.args,
        value: request.value,
        account: address,
      })
      setSimulating(false)
      const txHash = await write.mutateAsync({
        address: request.address,
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
        value: request.value,
        chainId: CHAIN_ID,
      })
      setHash(txHash)
    } catch (e) {
      setError(describeError(e, errorMessages))
    } finally {
      setSimulating(false)
    }
  }

  const label = simulating ? 'Checking…' : signing ? 'Confirm in wallet…' : mining ? 'Pending…' : children

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={`btn btn-primary ${className}`}
        disabled={disabled || busy || !address}
        aria-busy={busy}
        onClick={send}
      >
        {busy ? <Spinner /> : null}
        {label}
      </button>

      {hash ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-live="polite">
          {confirmed && refreshed ? (
            <span className="inline-flex items-center gap-1 text-accent-2">
              <CheckIcon size={15} /> Confirmed · balances refreshed
            </span>
          ) : confirmed ? (
            <span className="inline-flex items-center gap-1.5 text-accent-2">
              <CheckIcon size={15} /> Confirmed in block {receipt.data?.blockNumber.toString()} · refreshing balances…
            </span>
          ) : reverted ? (
            <span className="text-danger">Reverted on-chain</span>
          ) : (
            <span className="text-muted">Waiting for confirmation…</span>
          )}
          <a className="link inline-flex items-center gap-1" href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
            View on Blockscout <ExternalIcon />
          </a>
        </p>
      ) : null}

      {error || receiptError ? (
        <p className="text-sm text-danger" role="alert">
          {error ?? receiptError}
        </p>
      ) : null}
    </div>
  )
}
