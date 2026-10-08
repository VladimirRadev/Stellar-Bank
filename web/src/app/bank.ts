// Contract handles, bank math (mirrors src/StellarBank.sol), readable errors and shared read hooks.
import { useEffect, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { useConnection, useReadContracts } from 'wagmi'
import { iVladTokenAbi, stellarBankAbi } from '../abi'
import { CHAIN_ID, addresses } from '../config/addresses'
import type { ErrorMessages } from '../shell/errors'
import { isConfiguredAddress } from '../shell/format'

export const DEPLOYED = isConfiguredAddress(addresses.bank) && isConfiguredAddress(addresses.vladToken)

export const bank = { address: addresses.bank, abi: stellarBankAbi, chainId: CHAIN_ID } as const
export const token = { address: addresses.vladToken, abi: iVladTokenAbi, chainId: CHAIN_ID } as const

// Constants of StellarBank.sol (they are `constant`, so the UI does not need to read them).
export const BPS = 10_000n
export const LTV_BPS = 5_000n
export const LIQ_THRESHOLD_BPS = 7_500n
export const LIQ_BONUS_BPS = 1_000n
export const YEAR = 31_536_000n
export const WAD = 10n ** 18n
export const MAX_UINT = 2n ** 256n - 1n

/** Seconds of interest added on top of a live amount, so "Max" / approvals still cover it when the tx is mined. */
export const SAFETY_SECONDS = 600

export const BANK_ERRORS: ErrorMessages = {
  ExceedsLtv: () => 'That would push your debt above 50% of your collateral value (the LTV limit).',
  InsufficientLiquidity: () => 'The bank does not hold enough VLAD right now. Try a smaller amount.',
  InsufficientSavings: () => 'You cannot withdraw more than your savings balance.',
  InsufficientCollateral: () => 'You cannot withdraw more ETH than you deposited as collateral.',
  Healthy: () => 'This position is healthy (health factor of 1 or more), so it cannot be liquidated.',
  NoLiquidityInPool: () => 'The Stellar AMM pool has no liquidity, so there is no ETH price right now.',
  SameBlockPriceUpdate: () => 'The AMM price changed in this block, try again in the next block',
  NoDebt: () => 'There is no debt to repay.',
  ZeroAmount: () => 'Enter an amount greater than zero.',
  EthTransferFailed: () => 'The ETH transfer to your address failed.',
  AccessControlUnauthorizedAccount: () => 'The bank is missing MINTER_ROLE on the VLAD token, so it cannot mint interest.',
}

/** Simple interest exactly like the contract, evaluated at a client-side time in milliseconds. */
export function accrue(principal: bigint, rateBps: bigint | undefined, lastAccrued: bigint, nowMs: number): bigint {
  if (principal === 0n || rateBps === undefined) return principal
  const elapsedMs = BigInt(Math.max(0, Math.floor(nowMs - Number(lastAccrued) * 1000)))
  return principal + (principal * rateBps * elapsedMs) / (YEAR * BPS * 1000n)
}

/** `amount` plus SAFETY_SECONDS of interest at `rateBps` (approvals and "Max" values that stay valid until mined). */
export function withBuffer(amount: bigint, rateBps: bigint | undefined): bigint {
  if (amount === 0n) return 0n
  return amount + (amount * (rateBps ?? 0n) * BigInt(SAFETY_SECONDS)) / (YEAR * BPS) + 1n
}

/** VLAD value of an ETH amount at `price` (VLAD per ETH, 1e18-scaled). */
export const valueOf = (eth: bigint, price: bigint) => (eth * price) / WAD

/** Health factor, 1e18-scaled; undefined means "no debt" (infinite). */
export function healthFactor(collateralEth: bigint, debt: bigint, price: bigint): bigint | undefined {
  if (debt === 0n) return undefined
  return (valueOf(collateralEth, price) * LIQ_THRESHOLD_BPS * WAD) / (debt * BPS)
}

/** ETH price (VLAD per ETH, 1e18-scaled) at which the health factor reaches exactly 1. */
export function liquidationPrice(collateralEth: bigint, debt: bigint): bigint | undefined {
  if (debt === 0n || collateralEth === 0n) return undefined
  return (debt * WAD * BPS) / (collateralEth * LIQ_THRESHOLD_BPS)
}

/** ETH a liquidator receives for repaying `debt`: debt + 10% at the spot price, capped at the collateral. */
export function seizeFor(debt: bigint, collateralEth: bigint, price: bigint): bigint {
  if (price === 0n) return collateralEth
  const seize = (((debt * (BPS + LIQ_BONUS_BPS)) / BPS) * WAD) / price
  return seize > collateralEth ? collateralEth : seize
}

export type Tone = 'good' | 'warn' | 'bad'

export function hfTone(hf: bigint | undefined): Tone {
  if (hf === undefined || hf >= (WAD * 3n) / 2n) return 'good'
  return hf >= WAD ? 'warn' : 'bad'
}

export const TONE_TEXT: Record<Tone, string> = { good: 'text-accent-2', warn: 'text-warning', bad: 'text-danger' }
export const TONE_COLOR: Record<Tone, string> = { good: '#34d399', warn: '#fbbf24', bad: '#f87171' }

export function formatHf(hf: bigint | undefined): string {
  if (hf === undefined) return '∞'
  if (hf >= 100n * WAD) return '>100'
  return (Number(hf / 10n ** 14n) / 10_000).toFixed(2)
}

export const formatApr = (bps: bigint | undefined) => (bps === undefined ? '—' : `${Number(bps) / 100}`)

/** Fixed number of decimals (no trimming), so a ticking number keeps its width. */
export function formatFixed(value: bigint | undefined, digits = 6): string {
  if (value === undefined) return '—'
  const [whole, fraction = ''] = formatUnits(value, 18).split('.')
  return `${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(digits, '0').slice(0, digits)}`
}

/** Parses a user-typed decimal amount; undefined when empty, invalid or zero. */
export function parseAmount(input: string, decimals = 18): bigint | undefined {
  if (!input.trim()) return undefined
  try {
    const v = parseUnits(input.trim(), decimals)
    return v > 0n ? v : undefined
  } catch {
    return undefined
  }
}

/** Bigint wei -> plain decimal string for an input field (no separators). */
export const toInput = (value: bigint, maxDigits = 6) => {
  const [whole, fraction = ''] = formatUnits(value, 18).split('.')
  const f = fraction.slice(0, maxDigits).replace(/0+$/, '')
  return f ? `${whole}.${f}` : whole
}

/** Rounds a wei amount down to `maxDigits` decimals (so a "Max" written into an input never exceeds the limit). */
export const floorTo = (value: bigint, maxDigits = 6) => {
  const unit = 10n ** BigInt(18 - maxDigits)
  return (value / unit) * unit
}

/** Current time in milliseconds, re-rendering every `intervalMs` (smooth ticking balances). */
export function useNowMs(intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Global bank state for the header tiles and every tab. */
export function useBankGlobals() {
  const q = useReadContracts({
    contracts: [
      { ...bank, functionName: 'ethPrice' },
      { ...bank, functionName: 'availableLiquidity' },
      { ...bank, functionName: 'savingsRateBps' },
      { ...bank, functionName: 'borrowRateBps' },
      { ...bank, functionName: 'borrowersCount' },
    ],
    query: { enabled: DEPLOYED, refetchInterval: 15_000 },
  })
  const r = q.data
  return {
    price: r?.[0]?.result,
    priceFailed: r?.[0]?.status === 'failure',
    liquidity: r?.[1]?.result,
    savingsRate: r?.[2]?.result,
    borrowRate: r?.[3]?.result,
    borrowersCount: r?.[4]?.result,
    loading: DEPLOYED && q.isLoading,
  }
}

/** The connected wallet's savings, loan and VLAD allowance for the bank. */
export function useBankUser() {
  const { address } = useConnection()
  const q = useReadContracts({
    contracts: address
      ? [
          { ...bank, functionName: 'savings', args: [address] },
          { ...bank, functionName: 'loans', args: [address] },
          { ...token, functionName: 'allowance', args: [address, addresses.bank] },
        ]
      : [],
    query: { enabled: DEPLOYED && !!address, refetchInterval: 15_000 },
  })
  const savings = q.data?.[0]?.result as readonly [bigint, bigint] | undefined
  const loan = q.data?.[1]?.result as readonly [bigint, bigint, bigint] | undefined
  return {
    address,
    savingsPrincipal: savings?.[0],
    savingsSince: savings?.[1],
    collateral: loan?.[0],
    debtPrincipal: loan?.[1],
    debtSince: loan?.[2],
    allowance: q.data?.[2]?.result as bigint | undefined,
    loading: DEPLOYED && !!address && q.isLoading,
  }
}
