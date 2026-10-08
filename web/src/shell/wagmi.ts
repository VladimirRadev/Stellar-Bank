import { defineChain } from 'viem'
import { sepolia as viemSepolia } from 'viem/chains'
import { createConfig, fallback, http, injected } from 'wagmi'

/** Public, key-less Sepolia RPC endpoints. Primary first, fallback second. */
export const RPC_PRIMARY = 'https://ethereum-sepolia-rpc.publicnode.com'
export const RPC_FALLBACK = 'https://sepolia.gateway.tenderly.co'
export const EXPLORER_URL = 'https://eth-sepolia.blockscout.com'

/** Sepolia with our RPCs and Blockscout as the explorer (also used by wallet_addEthereumChain). */
export const sepolia = defineChain({
  ...viemSepolia,
  rpcUrls: { default: { http: [RPC_PRIMARY, RPC_FALLBACK] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER_URL } },
})

export const wagmiConfig = createConfig({
  chains: [sepolia],
  // Injected wallet only (MetaMask). EIP-6963 discovery is off so exactly one connector exists.
  connectors: [injected()],
  multiInjectedProviderDiscovery: false,
  transports: {
    [sepolia.id]: fallback([
      http(RPC_PRIMARY, { batch: true, retryCount: 2 }),
      http(RPC_FALLBACK, { batch: true, retryCount: 2 }),
    ]),
  },
  // Group concurrent eth_call reads into one Multicall3 call.
  batch: { multicall: true },
  pollingInterval: 8_000,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
