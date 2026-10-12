// Contract handles, bank math (mirrors src/StellarBank.sol), readable errors and shared read hooks.
import { useEffect, useRef, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { useConnection, useReadContracts } from 'wagmi'
import { stellarBankAbi } from '../abi'
import { CHAIN_ID, addresses } from '../config/addresses'
import type { ErrorMessages } from '../shell/errors'
import { isConfiguredAddress } from '../shell/format'

export const DEPLOYED = isConfiguredAddress(addresses.bank) && isConfiguredAddress(addresses.vladToken)

export const bank = { address: addresses.bank, abi: stellarBankAbi, chainId: CHAIN_ID } as const

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

/** `amount` plus `seconds` of interest at `rateBps` (approvals and "Max" values that stay valid until mined). */
export function withBuffer(amount: bigint, rateBps: bigint | undefined, seconds = SAFETY_SECONDS): bigint {
  if (amount === 0n) return 0n
  return amount + (amount * (rateBps ?? 0n) * BigInt(seconds)) / (YEAR * BPS) + 1n
}

/** Interest buffer of a frozen debt approval, and the part of it that must still be left (see useDebtApproval). */
const APPROVAL_BUFFER_SECONDS = 3_600
const MIN_MARGIN_SECONDS = 120

/**
 * Approval amount for a debt that grows every second (repay everything, liquidate).
 *
 * ApproveThen compares the allowance with its `amount` on every render. If that amount were "live debt + buffer",
 * it would grow with every refetch, pass the approved value within seconds and bring the Approve step back right
 * after a confirmed approval. So the amount is frozen at debt + 1 hour of interest (at 10% APR that is 0.0011% of
 * the debt; the contract only pulls the debt itself) and recomputed only:
 * - when less than 120 s of that interest buffer is left, so the approval still covers the debt at the block the
 *   next transaction lands in (TxButton's simulation catches anything older);
 * - when the debt has dropped below half of the frozen amount (after a partial repayment).
 * A debt of 0 keeps the frozen value: it shows up when the repay or liquidation is already mined, and changing
 * `amount` then could swap out the pending TxButton before it has seen its receipt.
 */
export function useDebtApproval(debt: bigint | undefined, rateBps: bigint | undefined): bigint | undefined {
  const [frozen, setFrozen] = useState<bigint>()
  const stale =
    debt !== undefined &&
    debt > 0n &&
    (frozen === undefined || withBuffer(debt, rateBps, MIN_MARGIN_SECONDS) > frozen || debt * 2n < frozen)
  const next = stale ? withBuffer(debt, rateBps, APPROVAL_BUFFER_SECONDS) : frozen
  // Updated during render (React's pattern for state derived from new data): re-renders once, before painting.
  if (stale) setFrozen(next)
  return next
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

/** The connected wallet's savings and loan. (The VLAD allowance is read by the shared ApproveThen.) */
export function useBankUser() {
  const { address } = useConnection()
  const q = useReadContracts({
    contracts: address
      ? [
          { ...bank, functionName: 'savings', args: [address] },
          { ...bank, functionName: 'loans', args: [address] },
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
    loading: DEPLOYED && !!address && q.isLoading,
  }
}

/**
 * Success-toast text frozen at the moment of the click.
 *
 * TxButton builds its "Transaction confirmed" toast when the receipt arrives, from the props it has then.
 * The reads here refetch every 15 s and wagmi polls for the receipt every 8 s, so a refetch can land first and
 * already show the state after the transaction (debt back to 0, savings emptied). To report what was sent:
 * 1. wrap the TxButton in `<div className="contents" onClickCapture={capture}>`: `contents` keeps the
 *    wrapper out of the layout, and the capture phase runs `build()` before TxButton's own onClick;
 * 2. pass `message` as `successMessage`: TxButton calls it at receipt time and gets the text from the click.
 */
export function useMessageAtClick(build: () => string) {
  const atClick = useRef('')
  return {
    capture: () => {
      atClick.current = build()
    },
    message: () => atClick.current,
  }
}
