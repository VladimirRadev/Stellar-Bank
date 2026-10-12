import type { QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore, type ReactNode } from 'react'
import type { Hash, PublicClient } from 'viem'
import { describeError } from './errors'
import { explorerTxUrl, truncateAddress } from './format'
import { toast } from './Toast'

/**
 * Receipt tracker shared by all Stellar apps. It lives at module level, outside React, so a
 * transaction's toast, `onConfirmed` call and balance refresh still happen when the button that
 * sent it unmounts (a claim button that disappears after the refetch, ApproveThen swapping its
 * steps, a panel that closes).
 *
 * - `trackTx({...})` starts one background job per transaction hash (a second call with the same
 *   hash is ignored). The job waits for the receipt, toasts the result, calls `onConfirmed`, and
 *   refreshes every cached read with `syncAfterReceipt`.
 * - `useTrackedTx(hash)` lets any component show that transaction's phase.
 * - The store keeps the last MAX_TRACKED transactions (same pattern as Toast.tsx: an array plus
 *   `useSyncExternalStore`).
 */

/**
 * pending: no receipt yet. syncing: mined successfully, cached reads are being refreshed.
 * confirmed: mined successfully and the first refresh has finished. reverted: mined but reverted.
 * error: no receipt could be read (for example the 3-minute wait ran out); `error` says why.
 */
export type TxPhase = 'pending' | 'syncing' | 'confirmed' | 'reverted' | 'error'

export type TrackedTx = {
  hash: Hash
  phase: TxPhase
  /** Block of the receipt, set from 'syncing' or 'reverted' on. */
  blockNumber?: bigint
  /** Readable reason, set only in phase 'error'. */
  error?: string
  /** Date.now() when tracking started. */
  startedAt: number
}

export type TrackTxOptions = {
  hash: Hash
  publicClient: PublicClient
  queryClient: QueryClient
  /**
   * Body of the "Transaction confirmed" toast. Pass a finished node: the caller resolves it when the
   * user clicks, so editing a form while the transaction is mined cannot change the message.
   */
  successMessage?: ReactNode
  /** Called once, right after the receipt says success, before the refresh starts. */
  onConfirmed?: (hash: Hash) => void
  /** Short name of the action (for example the button text); the toast body when there is no successMessage. */
  label?: string
}

/** Receipt polling interval. Sepolia mines a block every 12 s. */
const RECEIPT_POLL_MS = 3_000
/** How often the chain head is polled after a receipt, and how long before refreshing anyway. */
const HEAD_POLL_MS = 1_500
const HEAD_TIMEOUT_MS = 20_000
/** Extra refreshes after the first one, for RPC nodes behind a load balancer that lag behind the head. */
const FOLLOW_UP_REFRESH_MS = [3_000, 8_000] as const
const MAX_TRACKED = 20

let entries: readonly TrackedTx[] = []
const listeners = new Set<() => void>()

function setEntries(next: readonly TrackedTx[]) {
  entries = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const sameHash = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Replaces one entry with an updated copy. Entries already dropped from the list are ignored. */
function patch(hash: Hash, update: Partial<TrackedTx>) {
  if (!entries.some((e) => sameHash(e.hash, hash))) return
  setEntries(entries.map((e) => (sameHash(e.hash, hash) ? { ...e, ...update } : e)))
}

/** The tracked state of one transaction, or undefined when it is not (or no longer) tracked. */
export function useTrackedTx(hash: Hash | undefined): TrackedTx | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (hash ? entries.find((e) => sameHash(e.hash, hash)) : undefined),
    () => undefined,
  )
}

/**
 * Starts tracking a sent transaction. Returns at once; the work runs in the background:
 * 1. waits for the receipt (polled every 3 s, viem's default limit of 3 minutes);
 * 2. success: phase 'syncing', "Transaction confirmed" toast (body = `successMessage`), `onConfirmed(hash)`,
 *    `syncAfterReceipt`, then phase 'confirmed';
 * 3. reverted: phase 'reverted' and a "Transaction reverted" toast (cached reads are still refreshed,
 *    because the gas fee changed the ETH balance);
 * 4. no receipt (timeout or RPC failure): phase 'error' and a "Could not confirm the transaction" toast.
 * Every toast links the transaction on Blockscout. A hash that is already tracked is ignored.
 */
export function trackTx(options: TrackTxOptions): void {
  const { hash } = options
  if (entries.some((e) => sameHash(e.hash, hash))) return
  setEntries([...entries, { hash, phase: 'pending' as const, startedAt: Date.now() }].slice(-MAX_TRACKED))
  void follow(options)
}

async function follow({ hash, publicClient, queryClient, successMessage, onConfirmed, label }: TrackTxOptions) {
  const link = { href: explorerTxUrl(hash), hrefLabel: 'View on Blockscout', detail: truncateAddress(hash, 10, 8) }

  let receipt: Awaited<ReturnType<PublicClient['waitForTransactionReceipt']>>
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: RECEIPT_POLL_MS })
  } catch (e) {
    const reason =
      e instanceof Error && e.name === 'WaitForTransactionReceiptTimeoutError'
        ? 'No receipt after 3 minutes.'
        : describeError(e)
    patch(hash, { phase: 'error', error: reason })
    toast({
      kind: 'error',
      title: 'Could not confirm the transaction',
      body: `${label ? `${label}: ` : ''}${reason} It may still be mined: check Blockscout.`,
      ...link,
    })
    return
  }

  if (receipt.status !== 'success') {
    patch(hash, { phase: 'reverted', blockNumber: receipt.blockNumber })
    toast({
      kind: 'error',
      title: 'Transaction reverted',
      body: `Mined in block ${receipt.blockNumber.toString()} but reverted: nothing changed except the gas fee.`,
      ...link,
    })
    void syncAfterReceipt(publicClient, queryClient, receipt.blockNumber)
    return
  }

  patch(hash, { phase: 'syncing', blockNumber: receipt.blockNumber })
  toast({ kind: 'success', title: 'Transaction confirmed', body: successMessage ?? label, ...link })
  try {
    onConfirmed?.(hash)
  } catch (e) {
    // A failing callback must not stop the refresh below.
    console.error('onConfirmed failed', e)
  }
  await syncAfterReceipt(publicClient, queryClient, receipt.blockNumber)
  patch(hash, { phase: 'confirmed' })
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Refreshes every cached read after a mined transaction, in a way that survives lagging RPC nodes:
 * 1. polls the head block number every 1.5 s until it reaches `blockNumber` (at most 20 s), so the
 *    first refetch does not read pre-transaction state;
 * 2. runs `queryClient.invalidateQueries()`; the returned promise resolves when that refetch settles;
 * 3. runs it again 3 s and 8 s later (these keep running after the promise resolved), because the
 *    next request may hit a different node.
 * Never rejects.
 */
export async function syncAfterReceipt(publicClient: PublicClient, queryClient: QueryClient, blockNumber: bigint): Promise<void> {
  const deadline = Date.now() + HEAD_TIMEOUT_MS
  for (;;) {
    try {
      // cacheTime 0: viem otherwise reuses a block number up to 4 s old.
      if ((await publicClient.getBlockNumber({ cacheTime: 0 })) >= blockNumber) break
    } catch {
      // A failed head read is retried on the next tick.
    }
    if (Date.now() >= deadline) break
    await wait(HEAD_POLL_MS)
  }
  const refresh = () => queryClient.invalidateQueries().catch(() => {})
  for (const ms of FOLLOW_UP_REFRESH_MS) setTimeout(() => void refresh(), ms)
  await refresh()
}
