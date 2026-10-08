import { formatUnits, zeroAddress, type Address, type Hash } from 'viem'
import { EXPLORER_URL } from './wagmi'

/** True when an address from config/addresses.ts is a real deployment, not the zero placeholder. */
export function isConfiguredAddress(address: Address | undefined): address is Address {
  return !!address && address.toLowerCase() !== zeroAddress
}

/**
 * Formats a token amount (bigint in base units) for display, with thousands separators.
 * Example: formatToken(1234567890000000000000n) -> "1,234.57"
 */
export function formatToken(value: bigint | undefined, decimals = 18, maxFractionDigits = 2): string {
  if (value === undefined) return '—'
  const [whole, fraction = ''] = formatUnits(value, decimals).split('.')
  const wholeFormatted = BigInt(whole).toLocaleString('en-US')
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, '')
  if (trimmed) return `${wholeFormatted}.${trimmed}`
  if (value > 0n && whole === '0') return `<0.${'0'.repeat(Math.max(0, maxFractionDigits - 1))}1`
  return wholeFormatted
}

/** Compact amount: 1_250_000 VLAD -> "1.25M". */
export function formatCompact(value: bigint | undefined, decimals = 18): string {
  if (value === undefined) return '—'
  const n = Number(formatUnits(value, decimals))
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
}

/** 0x1234…abcd */
export function truncateAddress(address: string | undefined, start = 6, end = 4): string {
  if (!address) return ''
  if (address.length <= start + end + 1) return address
  return `${address.slice(0, start)}…${address.slice(-end)}`
}

/** Human duration: 21600 -> "6h", 5400 -> "1h 30m", 45 -> "45s". */
export function formatDuration(totalSeconds: number | bigint | undefined): string {
  if (totalSeconds === undefined) return '—'
  let s = Math.max(0, Math.floor(Number(totalSeconds)))
  const d = Math.floor(s / 86_400)
  s -= d * 86_400
  const h = Math.floor(s / 3_600)
  s -= h * 3_600
  const m = Math.floor(s / 60)
  s -= m * 60
  const parts = [d && `${d}d`, h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean)
  return parts.length ? parts.slice(0, 2).join(' ') : '0s'
}

/** Countdown clock: 3725 -> "01:02:05". Adds "Nd " when longer than a day. */
export function formatCountdown(secondsLeft: number): string {
  const total = Math.max(0, Math.floor(secondsLeft))
  const d = Math.floor(total / 86_400)
  const h = Math.floor((total % 86_400) / 3_600)
  const m = Math.floor((total % 3_600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`
}

/** Local date-time for a unix timestamp in seconds. */
export function formatTimestamp(seconds: number | bigint): string {
  return new Date(Number(seconds) * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export const explorerAddressUrl = (address: string) => `${EXPLORER_URL}/address/${address}`
export const explorerTxUrl = (hash: Hash | string) => `${EXPLORER_URL}/tx/${hash}`
