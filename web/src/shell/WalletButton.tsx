import { useState } from 'react'
import { useConnection, useDisconnect } from 'wagmi'
import { truncateAddress } from './format'
import { CheckIcon, LogoutIcon, Spinner } from './icons'
import { useConnectWallet } from './useConnectWallet'

/** `compact` shortens the label below the `sm` breakpoint (used in the header). */
export function ConnectButton({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const { connect, isPending, hasWallet } = useConnectWallet()
  if (!hasWallet) {
    return (
      <a className={`btn btn-primary ${className}`} href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        {compact ? <span className="sm:hidden">MetaMask</span> : null}
        <span className={compact ? 'hidden sm:inline' : undefined}>Install MetaMask</span>
      </a>
    )
  }
  return (
    <button type="button" className={`btn btn-primary ${className}`} onClick={connect} disabled={isPending}>
      {isPending ? <Spinner /> : null}
      {isPending ? (
        'Connecting…'
      ) : (
        <>
          {compact ? <span className="sm:hidden">Connect</span> : null}
          <span className={compact ? 'hidden sm:inline' : undefined}>Connect wallet</span>
        </>
      )}
    </button>
  )
}

/** Header wallet control: connect, or show the truncated address (click copies it) plus a disconnect button. */
export function WalletButton() {
  const { address, isConnected } = useConnection()
  const disconnect = useDisconnect()
  const [copied, setCopied] = useState(false)

  if (!isConnected || !address) return <ConnectButton className="h-9 min-h-9 px-4 text-sm sm:h-10 sm:min-h-10" compact />

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        className="chip h-9 gap-2 font-mono text-[0.8rem] transition hover:border-accent-2/50 sm:h-10"
        title="Copy address"
        aria-label={copied ? 'Address copied' : `Copy address ${address}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address)
            setCopied(true)
            setTimeout(() => setCopied(false), 1_500)
          } catch {
            /* clipboard blocked */
          }
        }}
      >
        <span
          className="size-2.5 rounded-full"
          style={{ background: `linear-gradient(135deg, #${address.slice(2, 8)}, #${address.slice(-6)})` }}
          aria-hidden
        />
        {copied ? (
          <span className="inline-flex items-center gap-1 text-accent-2">
            <CheckIcon size={14} /> Copied
          </span>
        ) : (
          <>
            <span className="sm:hidden">{truncateAddress(address, 4, 4)}</span>
            <span className="hidden sm:inline">{truncateAddress(address)}</span>
          </>
        )}
      </button>
      <button
        type="button"
        className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-surface/70 text-muted transition hover:border-danger/50 hover:text-danger sm:size-10"
        title="Disconnect"
        aria-label="Disconnect wallet"
        onClick={() => disconnect.mutate()}
      >
        <LogoutIcon />
      </button>
    </div>
  )
}
