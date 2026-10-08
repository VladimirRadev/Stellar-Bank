import { useState } from 'react'
import { stellarBankAbi } from '../abi'
import { addresses } from '../config/addresses'
import { formatTimestamp, formatToken } from '../shell/format'
import { NetworkGate } from '../shell/NetworkGate'
import { TxButton } from '../shell/TxButton'
import { useVladBalance } from '../shell/useVladBalance'
import {
  BANK_ERRORS,
  BPS,
  DEPLOYED,
  MAX_UINT,
  YEAR,
  accrue,
  floorTo,
  formatApr,
  parseAmount,
  toInput,
  useBankGlobals,
  useBankUser,
  useNowMs,
} from './bank'
import { AmountInput, ApproveThen, LiveAmount, Line, Segmented } from './ui'

export function SaveTab() {
  const { savingsRate } = useBankGlobals()
  return (
    <div className="card overflow-hidden p-5 sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -left-20 -top-20 size-56 rounded-full bg-accent/10 blur-3xl" />
      <p className="eyebrow">
        Savings
        {savingsRate !== undefined ? ` · ${formatApr(savingsRate)}% APR` : ''}
      </p>
      <h2 className="mt-2 text-2xl font-semibold">Earn on idle VLAD</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
        Deposit VLAD and it earns simple interest every second. The interest is minted as new VLAD by the bank each time
        it is accrued, which happens on your next deposit or withdrawal.
      </p>
      <div className="mt-6">
        <NetworkGate connectMessage="Connect MetaMask to deposit VLAD and watch it earn interest.">
          <SavingsBody />
        </NetworkGate>
      </div>
    </div>
  )
}

function SavingsBody() {
  const { savingsRate, liquidity } = useBankGlobals()
  const { savingsPrincipal, savingsSince, allowance } = useBankUser()
  const nowMs = useNowMs(1_000)
  const live = savingsPrincipal !== undefined && savingsSince !== undefined
  const balance = live ? accrue(savingsPrincipal, savingsRate, savingsSince, nowMs) : undefined
  const perDay = savingsPrincipal !== undefined && savingsRate !== undefined ? (savingsPrincipal * savingsRate * 86_400n) / (YEAR * BPS) : undefined

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-2 opacity-50" />
            <span className="relative inline-flex size-2 rounded-full bg-accent-2" />
          </span>
          Savings balance · live
        </p>
        <p className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="min-w-0 truncate font-mono text-3xl font-semibold tabular-nums text-text sm:text-4xl">
            <LiveAmount principal={savingsPrincipal} rateBps={savingsRate} since={savingsSince} />
          </span>
          <span className="text-muted">VLAD</span>
        </p>
        <div className="mt-4 divide-y divide-border/70 border-t border-border/70">
          <Line label="Principal at last accrual">{formatToken(savingsPrincipal, 18, 4)} VLAD</Line>
          <Line label="Accrued since then" tone="good">
            +<LiveAmount principal={savingsPrincipal} rateBps={savingsRate} since={savingsSince} interestOnly /> VLAD
          </Line>
          <Line label="Earning per day">{formatToken(perDay, 18, 4)} VLAD</Line>
          <Line label="Last accrual">
            {savingsSince && savingsSince > 0n && savingsPrincipal ? formatTimestamp(savingsSince) : '—'}
          </Line>
        </div>
        <p className="mt-4 rounded-xl border border-accent/20 bg-accent/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-muted">
          Interest is minted on accrual: when you deposit or withdraw, the bank mints the interest earned so far as new
          VLAD and adds it to your principal. Between accruals the balance above is computed in your browser with the same
          formula as the contract.
        </p>
      </div>

      <SavingsActions balance={balance} liquidity={liquidity} allowance={allowance} />
    </div>
  )
}

function SavingsActions({
  balance,
  liquidity,
  allowance,
}: {
  balance: bigint | undefined
  liquidity: bigint | undefined
  allowance: bigint | undefined
}) {
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [input, setInput] = useState('')
  const [max, setMax] = useState(false)
  const { balance: wallet } = useVladBalance()
  const amount = parseAmount(input)

  const switchMode = (m: 'deposit' | 'withdraw') => {
    setMode(m)
    setInput('')
    setMax(false)
  }

  const tooMuchDeposit = mode === 'deposit' && amount !== undefined && wallet !== undefined && amount > wallet
  const tooMuchWithdraw = mode === 'withdraw' && !max && amount !== undefined && balance !== undefined && amount > balance
  const withdrawAmount = max ? balance : amount
  const lowLiquidity =
    mode === 'withdraw' && withdrawAmount !== undefined && liquidity !== undefined && withdrawAmount > liquidity

  return (
    <div className="min-w-0 space-y-5 rounded-2xl border border-border/80 bg-bg/40 p-4 sm:p-5">
      <Segmented
        label="Savings action"
        value={mode}
        onChange={switchMode}
        options={[
          { key: 'deposit', label: 'Deposit' },
          { key: 'withdraw', label: 'Withdraw' },
        ]}
      />

      {mode === 'deposit' ? (
        <>
          <AmountInput
            id="save-deposit"
            label="Amount"
            value={input}
            onChange={setInput}
            symbol="VLAD"
            hint={`Wallet: ${formatToken(wallet)} VLAD`}
            onMax={wallet ? () => setInput(toInput(wallet, 18)) : undefined}
          />
          {tooMuchDeposit ? <p className="text-sm text-danger">Not enough VLAD in your wallet.</p> : null}
          <ApproveThen need={amount} allowance={allowance} disabled={!DEPLOYED || tooMuchDeposit}>
            <TxButton
              request={{ address: addresses.bank, abi: stellarBankAbi, functionName: 'depositSavings', args: [amount ?? 0n] }}
              disabled={!DEPLOYED || amount === undefined || tooMuchDeposit}
              errorMessages={BANK_ERRORS}
              className="h-12 w-full"
              onConfirmed={() => setInput('')}
            >
              {amount ? `Deposit ${formatToken(amount)} VLAD` : 'Deposit VLAD'}
            </TxButton>
          </ApproveThen>
        </>
      ) : (
        <>
          <AmountInput
            id="save-withdraw"
            label="Amount"
            value={input}
            onChange={(v) => {
              setInput(v)
              setMax(false)
            }}
            symbol="VLAD"
            hint={`Savings: ${formatToken(balance)} VLAD`}
            maxActive={max}
            onMax={
              balance
                ? () => {
                    setInput(toInput(floorTo(balance)))
                    setMax(true)
                  }
                : undefined
            }
          />
          {max ? (
            <p className="text-xs text-muted">MAX withdraws everything, including interest accrued until the block it lands in.</p>
          ) : null}
          {tooMuchWithdraw ? <p className="text-sm text-danger">That is more than your savings balance.</p> : null}
          {lowLiquidity ? (
            <p className="text-sm text-warning">
              The bank holds {formatToken(liquidity)} VLAD of free liquidity right now; the rest is lent out to borrowers.
            </p>
          ) : null}
          <TxButton
            request={{
              address: addresses.bank,
              abi: stellarBankAbi,
              functionName: 'withdrawSavings',
              args: [max ? MAX_UINT : (amount ?? 0n)],
            }}
            disabled={!DEPLOYED || (!max && amount === undefined) || tooMuchWithdraw}
            errorMessages={BANK_ERRORS}
            className="h-12 w-full"
            onConfirmed={() => {
              setInput('')
              setMax(false)
            }}
          >
            {max ? 'Withdraw everything' : amount ? `Withdraw ${formatToken(amount)} VLAD` : 'Withdraw VLAD'}
          </TxButton>
        </>
      )}
    </div>
  )
}
