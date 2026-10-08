import type { Address } from 'viem'

/** Ethereum Sepolia. */
export const CHAIN_ID = 11155111 as const

/**
 * Deployed contract addresses on Sepolia (see deployments/sepolia.json).
 * `vladToken` comes from Stellar-Faucet, `pool` (StellarPool) from Stellar-LP-Staking, `bank` from this repo.
 * The zero address is a placeholder: the UI shows a "not deployed yet" state for it.
 */
export const addresses = {
  vladToken: '0x49ba857d553ef219B144b200F41acaf8CB6768E9',
  bank: '0x4Dd37833521B458E72139eF77a17Ff9A50FC1588',
  pool: '0xAC08AA11850cf015160A93DAD746CA480407b7Ae',
} as const satisfies Record<string, Address>

/** Contracts listed in the footer, with Blockscout links. */
export const footerContracts: readonly { label: string; address: Address }[] = [
  { label: 'StellarBank', address: addresses.bank },
  { label: 'VladToken ($VLAD)', address: addresses.vladToken },
  { label: 'StellarPool (price source)', address: addresses.pool },
]
