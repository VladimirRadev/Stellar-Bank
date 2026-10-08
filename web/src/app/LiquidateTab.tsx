import { useMemo, useState, type ReactNode } from 'react'
import type { Address } from 'viem'
import { useConnection, useReadContracts } from 'wagmi'
import { stellarBankAbi } from '../abi'
import { addresses } from '../config/addresses'
import { explorerAddressUrl, formatToken, truncateAddress } from '../shell/format'
import { ExternalIcon, StarGlyph } from '../shell/icons'
import { NetworkGate } from '../shell/NetworkGate'
import { TxButton } from '../shell/TxButton'
import { useVladBalance } from '../shell/useVladBalance'
import {
  BANK_ERRORS,
  DEPLOYED,
  MAX_UINT,
  TONE_TEXT,
  WAD,
  bank,
  formatHf,
  hfTone,
  seizeFor,
  useBankGlobals,
  useBankUser,
  valueOf,
  withBuffer,
} from './bank'
import { ApproveThen } from './ui'

const MAX_ROWS = 50

type Row = {
  borrower: Address
  debt: bigint | undefined
  collateral: bigint | undefined
  /** undefined = no debt (infinite health factor). */
  hf: bigint | undefined
  /** false when the health factor could not be read (for example the pool has no liquidity). */
  hfKnown: boolean
}

export function LiquidateTab() {
  const g = useBankGlobals()
  const { address: me } = useConnection()
  const total = g.borrowersCount ?? 0n
  const shown = Number(total > BigInt(MAX_ROWS) ? BigInt(MAX_ROWS) : total)

  const list = useReadContracts({
    contracts: Array.from({ length: shown }, (_, i) => ({ ...bank, functionName: 'borrowers', args: [BigInt(i)] }) as const),
    query: { enabled: DEPLOYED && shown > 0 },
  })
  const borrowers = (list.data ?? []).map((r) => r.result as Address | undefined).filter((a): a is Address => !!a)

  // One multicall for every row: debtOf, loans and healthFactorOf per borrower.
  const details = useReadContracts({
    contracts: borrowers.flatMap(
      (b) =>
        [
          { ...bank, functionName: 'debtOf', args: [b] },
          { ...bank, functionName: 'loans', args: [b] },
          { ...bank, functionName: 'healthFactorOf', args: [b] },
        ] as const,
    ),
    query: { enabled: DEPLOYED && borrowers.length > 0, refetchInterval: 15_000 },
  })

  const [ascending, setAscending] = useState(true)
  const [open, setOpen] = useState<Address>()

  const rows = useMemo(() => {
    const d = details.data
    const out: Row[] = borrowers.map((borrower, i) => {
      const debt = d?.[i * 3]?.result as bigint | undefined
      const loan = d?.[i * 3 + 1]?.result as readonly [bigint, bigint, bigint] | undefined
      const hfRes = d?.[i * 3 + 2]
      const hfRaw = hfRes?.status === 'success' ? (hfRes.result as bigint) : undefined
      return {
        borrower,
        debt,
        collateral: loan?.[0],
        hf: hfRaw === undefined || hfRaw === MAX_UINT ? undefined : hfRaw,
        hfKnown: hfRes?.status === 'success' || debt === 0n,
      }
    })
    // Infinite (no debt) sorts as the healthiest; unknown rows always go last.
    const key = (r: Row) => (!r.hfKnown ? Infinity : r.hf === undefined ? Number.MAX_VALUE : Number(r.hf) / 1e18)
    return out.sort((a, b) => {
      if (!a.hfKnown !== !b.hfKnown) return a.hfKnown ? -1 : 1
      return ascending ? key(a) - key(b) : key(b) - key(a)
    })
  }, [borrowers, details.data, ascending])

  const loading = DEPLOYED && (g.loading || list.isLoading || details.isLoading)
  const liquidatable = rows.filter((r) => r.hf !== undefined && r.hf < WAD).length

  return (
    <div className="card overflow-hidden p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Liquidations</p>
          <h2 className="mt-2 text-2xl font-semibold">Borrowers</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            A position with a health factor below 1 can be liquidated by anyone: you repay its whole VLAD debt and receive
            the same value in ETH plus a 10% bonus.
          </p>
        </div>
        {rows.length > 0 ? (
          <p className="chip">
            <span className={liquidatable > 0 ? 'text-danger' : 'text-accent-2'}>{liquidatable}</span> liquidatable
          </p>
        ) : null}
      </div>

      {total > BigInt(MAX_ROWS) ? (
        <p className="mt-4 text-xs text-muted">
          Showing the first {MAX_ROWS} of {total.toString()} borrowers.
        </p>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <span key={i} className="skeleton block h-14 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/40 px-5 py-10 text-center">
            <span className="mx-auto grid size-11 place-items-center rounded-xl border border-border bg-surface-2/70">
              <StarGlyph size={18} />
            </span>
            <p className="mt-3 font-display text-lg font-semibold">No borrowers yet</p>
            <p className="mt-1 text-sm text-muted">
              {DEPLOYED
                ? 'When someone opens a credit line it appears here with its live health factor.'
                : 'The bank is not deployed yet, so there are no credit lines to show.'}
            </p>
          </div>
        ) : (
          <div role="table" aria-label="Borrowers" className="overflow-hidden rounded-2xl border border-border/80">
            <div
              role="row"
              className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_9rem] gap-4 border-b border-border/80 bg-surface/60 px-4 py-3 md:grid"
            >
              <span role="columnheader" className="eyebrow">Borrower</span>
              <span role="columnheader" className="eyebrow text-right">Collateral</span>
              <span role="columnheader" className="eyebrow text-right">Debt</span>
              <span role="columnheader" className="text-right" aria-sort={ascending ? 'ascending' : 'descending'}>
                <button
                  type="button"
                  className="eyebrow inline-flex items-center gap-1 transition hover:text-text"
                  onClick={() => setAscending((a) => !a)}
                >
                  Health {ascending ? '↑' : '↓'}
                </button>
              </span>
              <span role="columnheader" className="sr-only">
                Action
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-border/80 bg-surface/60 px-4 py-2.5 md:hidden">
              <span className="eyebrow">{rows.length} borrowers</span>
              <button type="button" className="eyebrow transition hover:text-text" onClick={() => setAscending((a) => !a)}>
                Sort by health {ascending ? '↑' : '↓'}
              </button>
            </div>
            <ul role="rowgroup" className="divide-y divide-border/70">
              {rows.map((row) => (
                <BorrowerRow
                  key={row.borrower}
                  row={row}
                  isMe={!!me && me.toLowerCase() === row.borrower.toLowerCase()}
                  open={open === row.borrower}
                  onToggle={() => setOpen((o) => (o === row.borrower ? undefined : row.borrower))}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function BorrowerRow({ row, isMe, open, onToggle }: { row: Row; isMe: boolean; open: boolean; onToggle: () => void }) {
  const canLiquidate = row.hf !== undefined && row.hf < WAD && (row.debt ?? 0n) > 0n
  const tone = hfTone(row.hf)
  return (
    <li role="row" className={canLiquidate ? 'bg-danger/[0.04]' : undefined}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_9rem] md:items-center">
        <div role="cell" className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-1">
          <a
            className="link inline-flex min-w-0 items-center gap-1 font-mono text-sm"
            href={explorerAddressUrl(row.borrower)}
            target="_blank"
            rel="noreferrer"
          >
            <span className="truncate">{truncateAddress(row.borrower, 8, 6)}</span> <ExternalIcon />
          </a>
          {isMe ? <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[0.7rem] font-medium text-accent-2">you</span> : null}
        </div>
        <Cell label="Collateral">{formatToken(row.collateral, 18, 4)} ETH</Cell>
        <Cell label="Debt">{formatToken(row.debt)} VLAD</Cell>
        <Cell label="Health factor">
          <span className={row.hfKnown ? TONE_TEXT[tone] : 'text-muted'}>{row.hfKnown ? formatHf(row.hf) : '—'}</span>
        </Cell>
        <div role="cell" className="flex items-end md:justify-end">
          <button
            type="button"
            className={`btn h-10 min-h-10 w-full px-4 text-sm md:w-auto ${canLiquidate ? 'btn-primary' : 'btn-ghost'}`}
            disabled={!canLiquidate}
            aria-expanded={canLiquidate ? open : undefined}
            title={canLiquidate ? undefined : 'Only positions with a health factor below 1 can be liquidated'}
            onClick={onToggle}
          >
            {canLiquidate ? (open ? 'Close' : 'Liquidate') : 'Healthy'}
          </button>
        </div>
      </div>
      {open && canLiquidate && row.debt !== undefined && row.collateral !== undefined ? (
        <LiquidatePanel borrower={row.borrower} debt={row.debt} collateral={row.collateral} />
      ) : null}
    </li>
  )
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="cell" className="min-w-0 md:text-right">
      <p className="eyebrow md:hidden">{label}</p>
      <p className="mt-1 truncate font-mono text-sm tabular-nums md:mt-0">{children}</p>
    </div>
  )
}

function LiquidatePanel({ borrower, debt, collateral }: { borrower: Address; debt: bigint; collateral: bigint }) {
  const g = useBankGlobals()
  const { allowance } = useBankUser()
  const { balance } = useVladBalance()
  const price = g.price
  const seize = price ? seizeFor(debt, collateral, price) : undefined
  const need = withBuffer(debt, g.borrowRate)
  const short = balance !== undefined && balance < need

  return (
    <div className="border-t border-border/70 bg-bg/40 px-4 py-4">
      <p className="text-sm leading-relaxed">
        You pay <span className="font-mono font-semibold">{formatToken(debt)} VLAD</span>, you receive ≈{' '}
        <span className="font-mono font-semibold text-accent-2">{formatToken(seize, 18, 4)} ETH</span> (10% bonus)
        {seize !== undefined && price ? (
          <span className="text-muted"> · worth ≈ {formatToken(valueOf(seize, price))} VLAD at the spot price</span>
        ) : null}
      </p>
      <p className="mt-1 text-xs text-muted">
        The approval adds a small buffer because the debt keeps growing until the transaction is mined.
      </p>
      <div className="mt-4 max-w-sm">
        <NetworkGate connectMessage="Connect MetaMask to liquidate this position.">
          {short ? <p className="mb-3 text-sm text-danger">Your wallet holds less VLAD than this debt.</p> : null}
          <ApproveThen need={need} allowance={allowance} disabled={!DEPLOYED || short}>
            <TxButton
              request={{ address: addresses.bank, abi: stellarBankAbi, functionName: 'liquidate', args: [borrower] }}
              disabled={!DEPLOYED || short}
              errorMessages={BANK_ERRORS}
              className="h-12 w-full"
            >
              Liquidate {truncateAddress(borrower)}
            </TxButton>
          </ApproveThen>
        </NetworkGate>
      </div>
    </div>
  )
}
