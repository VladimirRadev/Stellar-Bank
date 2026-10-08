import { useState } from 'react'
import { parseEther } from 'viem'
import { useBalance } from 'wagmi'
import { stellarBankAbi } from '../abi'
import { CHAIN_ID, addresses } from '../config/addresses'
import { formatToken } from '../shell/format'
import { NetworkGate } from '../shell/NetworkGate'
import { TxButton } from '../shell/TxButton'
import { useVladBalance } from '../shell/useVladBalance'
import {
  BANK_ERRORS,
  BPS,
  DEPLOYED,
  LTV_BPS,
  MAX_UINT,
  SAFETY_SECONDS,
  TONE_TEXT,
  WAD,
  accrue,
  floorTo,
  formatApr,
  formatHf,
  healthFactor,
  hfTone,
  liquidationPrice,
  parseAmount,
  toInput,
  useBankGlobals,
  useBankUser,
  useNowMs,
  valueOf,
} from './bank'
import { AmountInput, ApproveThen, HealthGauge, LiveAmount, Line, Meter, Segmented } from './ui'

type Action = 'deposit' | 'withdraw' | 'borrow' | 'repay'
const GAS_RESERVE = parseEther('0.005')

export function CreditTab() {
  const { borrowRate } = useBankGlobals()
  return (
    <div className="card overflow-hidden p-5 sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full bg-lime/10 blur-3xl" />
      <p className="eyebrow">
        Credit line
        {borrowRate !== undefined ? ` · ${formatApr(borrowRate)}% APR` : ''}
      </p>
      <h2 className="mt-2 text-2xl font-semibold">Borrow VLAD against ETH</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
        Lock ETH as collateral and borrow VLAD up to 50% of its value. Keep the health factor above 1: below it, anyone
        can repay your debt and take your ETH plus a 10% bonus.
      </p>
      <div className="mt-6">
        <NetworkGate connectMessage="Connect MetaMask to open a VLAD credit line backed by ETH.">
          <CreditBody />
        </NetworkGate>
      </div>
    </div>
  )
}

function CreditBody() {
  const g = useBankGlobals()
  const u = useBankUser()
  const nowMs = useNowMs(1_000)

  const collateral = u.collateral ?? 0n
  const debt =
    u.debtPrincipal !== undefined && u.debtSince !== undefined ? accrue(u.debtPrincipal, g.borrowRate, u.debtSince, nowMs) : 0n
  const price = g.price
  const value = price !== undefined ? valueOf(collateral, price) : undefined
  const maxBorrow = value !== undefined ? (value * LTV_BPS) / BPS : undefined
  const hf = price !== undefined ? healthFactor(collateral, debt, price) : undefined
  const hfKnown = price !== undefined || debt === 0n
  const liqPrice = liquidationPrice(collateral, debt)
  const used = maxBorrow && maxBorrow > 0n ? Number((debt * 10_000n) / maxBorrow) / 10_000 : debt > 0n ? 1 : 0
  const usedTone = used >= 0.9 ? 'bad' : used >= 0.7 ? 'warn' : 'good'
  const drop = liqPrice !== undefined && price ? 1 - Number((liqPrice * 10_000n) / price) / 10_000 : undefined

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
      <div className="min-w-0">
        <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,220px)_1fr]">
          <HealthGauge hf={hf} known={hfKnown} />
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted">Debt · live</p>
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="min-w-0 truncate font-mono text-3xl font-semibold tabular-nums">
                <LiveAmount principal={u.debtPrincipal} rateBps={g.borrowRate} since={u.debtSince} digits={4} />
              </span>
              <span className="text-muted">VLAD</span>
            </p>
            <p className={`text-sm ${TONE_TEXT[hfTone(hf)]}`}>
              {debt === 0n
                ? 'No debt: health factor is ∞'
                : !hfKnown
                  ? 'No price available'
                  : hfTone(hf) === 'bad'
                    ? 'Liquidatable now'
                    : hfTone(hf) === 'warn'
                      ? 'Close to liquidation'
                      : 'Healthy'}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted">Credit used</span>
            <span className={`font-mono tabular-nums ${TONE_TEXT[usedTone]}`}>{(used * 100).toFixed(1)}%</span>
          </div>
          <div className="mt-2">
            <Meter fraction={used} tone={usedTone} />
          </div>
        </div>

        <div className="mt-4 divide-y divide-border/70 border-t border-border/70">
          <Line label="Collateral">
            {formatToken(collateral, 18, 4)} ETH
            <span className="text-muted"> ≈ {formatToken(value)} VLAD</span>
          </Line>
          <Line label="Max borrow (50% LTV)">{formatToken(maxBorrow)} VLAD</Line>
          <Line label="Still available">
            {maxBorrow !== undefined ? formatToken(maxBorrow > debt ? maxBorrow - debt : 0n) : '—'} VLAD
          </Line>
          <Line label="Liquidation price" tone={liqPrice !== undefined ? hfTone(hf) : undefined}>
            {liqPrice !== undefined ? `${formatToken(liqPrice)} VLAD/ETH` : '—'}
          </Line>
          {drop !== undefined && drop > 0 ? (
            <p className="py-2.5 text-xs text-muted">
              ETH can fall {(drop * 100).toFixed(1)}% from {formatToken(price)} VLAD before this position can be liquidated.
            </p>
          ) : null}
        </div>
      </div>

      <CreditActions collateral={collateral} debtPrincipal={u.debtPrincipal} debtSince={u.debtSince} debt={debt} />
    </div>
  )
}

function CreditActions({
  collateral,
  debt,
  debtPrincipal,
  debtSince,
}: {
  collateral: bigint
  debt: bigint
  debtPrincipal: bigint | undefined
  debtSince: bigint | undefined
}) {
  const g = useBankGlobals()
  const { allowance, address } = useBankUser()
  const { balance: vlad } = useVladBalance()
  const eth = useBalance({ address, chainId: CHAIN_ID, query: { enabled: !!address } }).data?.value
  const [action, setAction] = useState<Action>('deposit')
  const [input, setInput] = useState('')
  const [max, setMax] = useState(false)
  const amount = parseAmount(input)
  const price = g.price
  const nowMs = useNowMs(1_000)

  // Debt projected SAFETY_SECONDS ahead, so "Max" and approvals still hold when the transaction is mined.
  const debtAhead =
    debtPrincipal !== undefined && debtSince !== undefined
      ? accrue(debtPrincipal, g.borrowRate, debtSince, nowMs + SAFETY_SECONDS * 1000)
      : debt

  const choose = (a: Action) => {
    setAction(a)
    setInput('')
    setMax(false)
  }
  const reset = () => {
    setInput('')
    setMax(false)
  }

  // Limits for each action.
  const maxBorrowTotal = price !== undefined ? (valueOf(collateral, price) * LTV_BPS) / BPS : undefined
  let borrowCap = maxBorrowTotal !== undefined && maxBorrowTotal > debtAhead ? maxBorrowTotal - debtAhead : 0n
  if (g.liquidity !== undefined && g.liquidity < borrowCap) borrowCap = g.liquidity
  const required =
    debtAhead === 0n ? 0n : price ? (debtAhead * BPS * WAD + price * LTV_BPS - 1n) / (price * LTV_BPS) : collateral
  const withdrawCap = collateral > required ? collateral - required : 0n

  // Health factor after the action (preview).
  const next = (() => {
    if (amount === undefined && !max) return undefined
    const a = amount ?? 0n
    if (action === 'deposit') return { c: collateral + a, d: debt }
    if (action === 'withdraw') return { c: collateral > a ? collateral - a : 0n, d: debt }
    if (action === 'borrow') return { c: collateral, d: debt + a }
    return { c: collateral, d: max || a >= debt ? 0n : debt - a }
  })()
  const hfNow = price !== undefined ? healthFactor(collateral, debt, price) : undefined
  const hfNext = next && price !== undefined ? healthFactor(next.c, next.d, price) : undefined

  let problem: string | undefined
  if (amount !== undefined) {
    if (action === 'deposit' && eth !== undefined && amount > eth) problem = 'Not enough ETH in your wallet.'
    if (action === 'withdraw' && amount > collateral) problem = 'That is more ETH than your collateral.'
    else if (action === 'withdraw' && amount > withdrawCap) problem = 'That would push your debt above 50% LTV.'
    if (action === 'borrow' && price === undefined) problem = 'No ETH price available from the pool.'
    else if (action === 'borrow' && maxBorrowTotal !== undefined && debt + amount > maxBorrowTotal)
      problem = 'That is above your 50% LTV limit.'
    else if (action === 'borrow' && g.liquidity !== undefined && amount > g.liquidity)
      problem = `The bank only holds ${formatToken(g.liquidity)} VLAD of free liquidity.`
    if (action === 'repay' && vlad !== undefined && amount > vlad) problem = 'Not enough VLAD in your wallet.'
  }
  if (action === 'repay' && max && vlad !== undefined && debtAhead > vlad) problem = 'Your wallet holds less VLAD than the full debt.'

  const repayNeed = max ? debtAhead : amount !== undefined && amount > debtAhead ? debtAhead : amount
  const ready = DEPLOYED && !problem && (amount !== undefined || max)

  const request =
    action === 'deposit'
      ? { address: addresses.bank, abi: stellarBankAbi, functionName: 'depositCollateral', value: amount ?? 0n }
      : action === 'withdraw'
        ? { address: addresses.bank, abi: stellarBankAbi, functionName: 'withdrawCollateral', args: [amount ?? 0n] }
        : action === 'borrow'
          ? { address: addresses.bank, abi: stellarBankAbi, functionName: 'borrow', args: [amount ?? 0n] }
          : { address: addresses.bank, abi: stellarBankAbi, functionName: 'repay', args: [max ? MAX_UINT : (amount ?? 0n)] }

  const label =
    action === 'deposit'
      ? `Deposit ${amount ? formatToken(amount, 18, 4) : ''} ETH`
      : action === 'withdraw'
        ? `Withdraw ${amount ? formatToken(amount, 18, 4) : ''} ETH`
        : action === 'borrow'
          ? `Borrow ${amount ? formatToken(amount) : ''} VLAD`
          : max
            ? 'Repay full debt'
            : `Repay ${amount ? formatToken(amount) : ''} VLAD`

  const button = (
    <TxButton request={request} disabled={!ready} errorMessages={BANK_ERRORS} className="h-12 w-full" onConfirmed={reset}>
      {label.replace(/\s+/g, ' ')}
    </TxButton>
  )

  return (
    <div className="min-w-0 space-y-5 rounded-2xl border border-border/80 bg-bg/40 p-4 sm:p-5">
      <Segmented
        label="Credit line action"
        value={action}
        onChange={choose}
        options={[
          { key: 'deposit', label: 'Add ETH' },
          { key: 'withdraw', label: 'Withdraw' },
          { key: 'borrow', label: 'Borrow' },
          { key: 'repay', label: 'Repay' },
        ]}
      />

      {action === 'deposit' ? (
        <AmountInput
          id="credit-deposit"
          label="Amount"
          value={input}
          onChange={setInput}
          symbol="ETH"
          hint={`Wallet: ${formatToken(eth, 18, 4)} ETH`}
          onMax={eth && eth > GAS_RESERVE ? () => setInput(toInput(floorTo(eth - GAS_RESERVE))) : undefined}
        />
      ) : action === 'withdraw' ? (
        <AmountInput
          id="credit-withdraw"
          label="Amount"
          value={input}
          onChange={setInput}
          symbol="ETH"
          hint={`Withdrawable: ${formatToken(withdrawCap, 18, 4)} ETH`}
          onMax={withdrawCap > 0n ? () => setInput(toInput(floorTo(withdrawCap))) : undefined}
        />
      ) : action === 'borrow' ? (
        <AmountInput
          id="credit-borrow"
          label="Amount"
          value={input}
          onChange={setInput}
          symbol="VLAD"
          hint={`Max: ${formatToken(borrowCap)} VLAD`}
          onMax={borrowCap > 0n ? () => setInput(toInput(floorTo(borrowCap))) : undefined}
        />
      ) : (
        <AmountInput
          id="credit-repay"
          label="Amount"
          value={input}
          onChange={(v) => {
            setInput(v)
            setMax(false)
          }}
          symbol="VLAD"
          hint={`Debt: ${formatToken(debt)} VLAD`}
          maxActive={max}
          onMax={
            debt > 0n
              ? () => {
                  setInput(toInput(debt, 4))
                  setMax(true)
                }
              : undefined
          }
        />
      )}

      {next ? (
        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-surface/40 px-3.5 py-2.5 text-sm">
          <span className="text-muted">Health factor after</span>
          <span className="font-mono tabular-nums">
            <span className={TONE_TEXT[hfTone(hfNow)]}>{price !== undefined || debt === 0n ? formatHf(hfNow) : '—'}</span>
            <span className="px-1.5 text-muted">→</span>
            <span className={TONE_TEXT[hfTone(hfNext)]}>
              {price !== undefined || next.d === 0n ? formatHf(hfNext) : '—'}
            </span>
          </span>
        </div>
      ) : null}
      {action === 'repay' && max ? (
        <p className="text-xs text-muted">MAX repays the whole debt, including interest up to the block it lands in.</p>
      ) : null}
      {problem ? <p className="text-sm text-danger">{problem}</p> : null}

      {action === 'repay' ? (
        <ApproveThen need={repayNeed} allowance={allowance} disabled={!ready}>
          {button}
        </ApproveThen>
      ) : (
        button
      )}
    </div>
  )
}
