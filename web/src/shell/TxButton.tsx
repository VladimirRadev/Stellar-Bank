import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Abi, Address, Hash } from 'viem'
import { useConnection, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CHAIN_ID } from '../config/addresses'
import { COMMON_ERRORS_ABI, describeError, type ErrorMessages } from './errors'
import { explorerTxUrl } from './format'
import { CheckIcon, ExternalIcon, Spinner } from './icons'

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
  /** Called once when the transaction is mined successfully. */
  onConfirmed?: (hash: Hash) => void
}

/**
 * One button for one contract write:
 * 1. simulates the call against the public RPC (custom errors are decoded before the wallet opens),
 * 2. asks the wallet to sign and send,
 * 3. waits for the receipt, shows a Blockscout link, then invalidates every cached query
 *    so balances and other reads refresh.
 */
export function TxButton({ request, children, disabled, className = '', errorMessages, onConfirmed }: TxButtonProps) {
  const { address } = useConnection()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()
  const write = useWriteContract()

  const [hash, setHash] = useState<Hash>()
  const [simulating, setSimulating] = useState(false)
  const [error, setError] = useState<string>()

  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID, query: { enabled: !!hash } })

  const handled = useRef<Hash | undefined>(undefined)
  useEffect(() => {
    const r = receipt.data
    if (!r || handled.current === r.transactionHash) return
    handled.current = r.transactionHash
    void queryClient.invalidateQueries()
    if (r.status === 'success') onConfirmed?.(r.transactionHash)
  }, [receipt.data, queryClient, onConfirmed])

  const signing = write.isPending
  const mining = !!hash && receipt.isLoading
  const busy = simulating || signing || mining
  const reverted = receipt.data?.status === 'reverted'
  const confirmed = receipt.data?.status === 'success'
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
          {confirmed ? (
            <span className="inline-flex items-center gap-1 text-accent-2">
              <CheckIcon size={15} /> Confirmed
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
