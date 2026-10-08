import { useConnect, useConnectors } from 'wagmi'
import { describeError } from './errors'

const hasInjectedWallet = () => typeof window !== 'undefined' && 'ethereum' in window && !!window.ethereum

/** Connect through the single injected connector (MetaMask). Shared by WalletButton and NetworkGate. */
export function useConnectWallet() {
  const connectors = useConnectors()
  const connect = useConnect()
  const connector = connectors[0]
  return {
    connect: () => connector && connect.mutate({ connector }),
    isPending: connect.isPending,
    error: connect.error ? describeError(connect.error) : undefined,
    hasWallet: hasInjectedWallet(),
  }
}
