import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { Abi, Address, Hash } from 'viem'
import { useConnection, usePublicClient, useWriteContract } from 'wagmi'
import { CHAIN_ID } from '../config/addresses'
import { COMMON_ERRORS_ABI, describeError, type ErrorMessages } from './errors'
import { explorerTxUrl, textOf } from './format'
import { CheckIcon, ExternalIcon, Spinner } from './icons'
import { trackTx, useTrackedTx } from './txTracker'

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
  /**
   * Called once, right when the receipt says success (before balances are refreshed). Use it to advance
   * steps. The function from the render in which the user clicked is used, and it is called even if
   * the button has unmounted by then.
   */
  onConfirmed?: (hash: Hash) => void
  /**
   * Body of the "Transaction confirmed" toast, with concrete amounts, for example
   * "Claimed 100 VLAD. Next claim in 6h.". A function receives the transaction hash.
   * It is resolved right after the wallet returns the hash, from the props of the render in which the
   * user clicked, so later form edits do not change it. Every TxButton that moves funds must pass one.
   */
  successMessage?: ReactNode | ((hash: Hash) => ReactNode)
}

/**
 * One button for one contract write:
 * 1. simulates the call against the public RPC (custom errors are decoded before the wallet opens),
 * 2. asks the wallet to sign and send,
 * 3. hands the hash to `trackTx` (txTracker.ts) with the click-time `successMessage` and `onConfirmed`.
 *    The tracker waits for the receipt, toasts the result with a Blockscout link, calls `onConfirmed`
 *    and refreshes every cached read. It runs outside React, so all of that also happens when this
 *    button unmounts before the receipt arrives.
 * The inline status line under the button reads the tracker (`useTrackedTx`).
 * Wallet rejections and simulation errors stay inline under the button; they are never toasted.
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
  const tracked = useTrackedTx(hash)

  // Everything below reads the props of the render in which the user clicked (this closure).
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
      trackTx({
        hash: txHash,
        publicClient,
        queryClient,
        successMessage: typeof successMessage === 'function' ? successMessage(txHash) : successMessage,
        onConfirmed,
        label: textOf(children).trim() || undefined,
      })
    } catch (e) {
      setError(describeError(e, errorMessages))
    } finally {
      setSimulating(false)
    }
  }

  const phase = hash ? (tracked?.phase ?? 'pending') : undefined
  const signing = write.isPending
  const mining = phase === 'pending'
  const busy = simulating || signing || mining

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
          {phase === 'confirmed' ? (
            <span className="inline-flex items-center gap-1 text-accent-2">
              <CheckIcon size={15} /> Confirmed · balances refreshed
            </span>
          ) : phase === 'syncing' ? (
            <span className="inline-flex items-center gap-1.5 text-accent-2">
              <CheckIcon size={15} /> Confirmed in block {tracked?.blockNumber?.toString()} · refreshing balances…
            </span>
          ) : phase === 'reverted' ? (
            <span className="text-danger">Reverted on-chain</span>
          ) : phase === 'error' ? (
            <span className="text-danger">{tracked?.error}</span>
          ) : (
            <span className="text-muted">Waiting for confirmation…</span>
          )}
          <a className="link inline-flex items-center gap-1" href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
            View on Blockscout <ExternalIcon />
          </a>
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
