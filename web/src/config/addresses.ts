import type { Address } from 'viem'

/** Ethereum Sepolia. */
export const CHAIN_ID = 11155111 as const

/**
 * Deployed contract addresses on Sepolia.
 * `vladToken` comes from Stellar-Faucet, `pool` (StellarPool) from Stellar-LP-Staking, `bank` from this repo.
 * The zero address is a placeholder: the UI shows a "not deployed yet" state for it.
 */
export const addresses = {
  vladToken: '0x0000000000000000000000000000000000000000',
  bank: '0x0000000000000000000000000000000000000000',
  pool: '0x0000000000000000000000000000000000000000',
} as const satisfies Record<string, Address>

/** Contracts listed in the footer, with Blockscout links. */
export const footerContracts: readonly { label: string; address: Address }[] = [
  { label: 'StellarBank', address: addresses.bank },
  { label: 'VladToken ($VLAD)', address: addresses.vladToken },
  { label: 'StellarPool (price source)', address: addresses.pool },
]
