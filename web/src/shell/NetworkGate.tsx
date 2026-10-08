import type { ReactNode } from 'react'
import { useConnection, useSwitchChain } from 'wagmi'
import { CHAIN_ID } from '../config/addresses'
import { describeError } from './errors'
import { Spinner } from './icons'
import { useConnectWallet } from './useConnectWallet'
import { ConnectButton } from './WalletButton'

type NetworkGateProps = {
  children: ReactNode
  /** Sentence shown above the connect button, for example "Connect to claim VLAD". */
  connectMessage?: string
}

/**
 * Renders `children` only when a wallet is connected AND on Sepolia.
 * Otherwise shows a connect call-to-action or a "Switch to Sepolia" button.
 */
export function NetworkGate({ children, connectMessage = 'Connect your wallet to continue.' }: NetworkGateProps) {
  const { isConnected, chainId } = useConnection()
  const switchChain = useSwitchChain()
  const { error: connectError } = useConnectWallet()

  if (!isConnected) {
    return (
      <GateBox title="Wallet not connected" text={connectMessage} error={connectError}>
        <ConnectButton className="w-full sm:w-auto" />
      </GateBox>
    )
  }

  if (chainId !== CHAIN_ID) {
    return (
      <GateBox
        title="Wrong network"
        text="This app runs on Ethereum Sepolia testnet (chain id 11155111)."
        error={switchChain.error ? describeError(switchChain.error) : undefined}
      >
        <button
          type="button"
          className="btn btn-primary w-full sm:w-auto"
          disabled={switchChain.isPending}
          onClick={() => switchChain.mutate({ chainId: CHAIN_ID })}
        >
          {switchChain.isPending ? <Spinner /> : null}
          Switch to Sepolia
        </button>
      </GateBox>
    )
  }

  return <>{children}</>
}

function GateBox({ title, text, error, children }: { title: string; text: string; error?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-center sm:p-6">
      <p className="font-display text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
      <div className="mt-4 flex justify-center">{children}</div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </div>
  )
}
