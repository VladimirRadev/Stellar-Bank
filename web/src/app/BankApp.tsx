import { useState, type ReactNode } from 'react'
import { addresses } from '../config/addresses'
import { explorerAddressUrl, formatCompact, formatToken } from '../shell/format'
import { ExternalIcon, StarGlyph } from '../shell/icons'
import { NetworkGate } from '../shell/NetworkGate'
import { StatTile } from '../shell/StatTile'
import { Tabs } from '../shell/Tabs'
import { CreditTab } from './CreditTab'
import { LiquidateTab } from './LiquidateTab'
import { SaveTab } from './SaveTab'
import {
  DEPLOYED,
  TONE_TEXT,
  accrue,
  formatApr,
  formatHf,
  healthFactor,
  hfTone,
  useBankGlobals,
  useBankUser,
  useNowMs,
} from './bank'
import { LiveAmount } from './ui'

type TabKey = 'save' | 'borrow' | 'liquidate'
const TABS = [
  { key: 'save', label: 'Save' },
  { key: 'borrow', label: 'Borrow' },
  { key: 'liquidate', label: 'Liquidate' },
] as const satisfies readonly { key: TabKey; label: string }[]

export function BankApp() {
  const [tab, setTab] = useState<TabKey>('save')
  const g = useBankGlobals()

  const openTab = (key: TabKey) => {
    setTab(key)
    document.getElementById('bank')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-12 sm:space-y-16">
      {!DEPLOYED ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm text-warning">
          StellarBank is not deployed yet. Its address in <code className="font-mono">config/addresses.ts</code> is a
          placeholder, so bank reads are switched off.
        </div>
      ) : null}

      {/* Hero + position snapshot */}
      <section className="grid items-start gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
        <div className="min-w-0 pt-2">
          <p className="eyebrow inline-flex items-center gap-2">
            <StarGlyph size={12} /> Stellar suite · credit distribution
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
            Stellar{' '}
            <span className="bg-gradient-to-r from-lime via-accent-2 to-accent bg-clip-text text-transparent">Bank</span>
          </h1>
          <p className="mt-3 font-display text-lg text-text/90 sm:text-xl">VLAD savings and ETH-backed credit lines</p>
          <p className="mt-5 max-w-xl text-[0.95rem] leading-relaxed text-muted">
            Deposit VLAD to earn {formatApr(g.savingsRate) === '—' ? '10' : formatApr(g.savingsRate)}% simple interest,
            minted on-chain. Or lock ETH and borrow VLAD against it at{' '}
            {formatApr(g.borrowRate) === '—' ? '20' : formatApr(g.borrowRate)}% APR. Prices come from the Stellar AMM, and
            any position whose health factor drops below 1 can be liquidated by anyone.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="chip">
              <span className="text-muted">Max LTV</span> <span className="font-mono">50%</span>
            </span>
            <span className="chip">
              <span className="text-muted">Liquidation threshold</span> <span className="font-mono">75%</span>
            </span>
            <span className="chip">
              <span className="text-muted">Liquidation bonus</span> <span className="font-mono">10%</span>
            </span>
          </div>
        </div>

        <PositionCard onOpen={openTab} />
      </section>

      {/* Header stats */}
      <section aria-label="Bank statistics" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <div className="col-span-2">
          <StatTile
            label="ETH price"
            value={g.price !== undefined ? formatToken(g.price) : '—'}
            unit={g.price !== undefined ? 'VLAD' : undefined}
            loading={g.loading}
            hint={g.priceFailed ? 'pool has no liquidity' : 'source: Stellar AMM spot, same-block guard'}
            highlight
          />
        </div>
        <StatTile
          label="VLAD liquidity"
          value={formatCompact(g.liquidity)}
          loading={g.loading}
          hint={g.liquidity !== undefined ? `${formatToken(g.liquidity, 18, 0)} VLAD free` : 'free to lend'}
        />
        <StatTile
          label="Savings APR"
          value={g.savingsRate !== undefined ? `${formatApr(g.savingsRate)}%` : '—'}
          loading={g.loading} hint="simple, minted" />
        <StatTile
          label="Borrow APR"
          value={g.borrowRate !== undefined ? `${formatApr(g.borrowRate)}%` : '—'}
          loading={g.loading} hint="simple, on debt" />
        <StatTile
          label="Borrowers"
          value={g.borrowersCount !== undefined ? g.borrowersCount.toString() : '—'}
          loading={g.loading}
          hint="credit lines opened"
        />
      </section>

      {/* Tabs */}
      <section id="bank" aria-label="Bank" className="scroll-mt-28">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Bank</p>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Save, borrow or liquidate</h2>
          </div>
          <Tabs tabs={TABS} value={tab} onChange={setTab} label="Bank sections" />
        </div>
        <div className="mt-6" role="tabpanel">
          {tab === 'save' ? <SaveTab /> : tab === 'borrow' ? <CreditTab /> : <LiquidateTab />}
        </div>
      </section>

      <HowItWorks />
    </div>
  )
}

function PositionCard({ onOpen }: { onOpen: (key: TabKey) => void }) {
  return (
    <div className="card overflow-hidden p-5 sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-accent/20 blur-3xl" />
      <p className="eyebrow">Your position</p>
      <h2 className="mt-2 text-2xl font-semibold">At a glance</h2>
      <div className="mt-6">
        <NetworkGate connectMessage="Connect MetaMask to see your savings and your credit line.">
          <PositionSummary onOpen={onOpen} />
        </NetworkGate>
      </div>
    </div>
  )
}

function PositionSummary({ onOpen }: { onOpen: (key: TabKey) => void }) {
  const g = useBankGlobals()
  const u = useBankUser()
  const nowMs = useNowMs(1_000)
  const debt =
    u.debtPrincipal !== undefined && u.debtSince !== undefined ? accrue(u.debtPrincipal, g.borrowRate, u.debtSince, nowMs) : 0n
  const hf = g.price !== undefined ? healthFactor(u.collateral ?? 0n, debt, g.price) : undefined
  const hfKnown = g.price !== undefined || debt === 0n

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Mini label="Savings" unit="VLAD">
          <LiveAmount principal={u.savingsPrincipal} rateBps={g.savingsRate} since={u.savingsSince} digits={4} />
        </Mini>
        <Mini label="Debt" unit="VLAD">
          <LiveAmount principal={u.debtPrincipal} rateBps={g.borrowRate} since={u.debtSince} digits={4} />
        </Mini>
        <Mini label="Collateral">{formatToken(u.collateral, 18, 4)} ETH</Mini>
        <Mini label="Health factor">
          <span className={hfKnown ? TONE_TEXT[hfTone(hf)] : 'text-muted'}>{hfKnown ? formatHf(hf) : '—'}</span>
        </Mini>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn btn-primary w-full" onClick={() => onOpen('save')}>
          Save VLAD
        </button>
        <button type="button" className="btn btn-ghost w-full" onClick={() => onOpen('borrow')}>
          Borrow VLAD
        </button>
      </div>
    </div>
  )
}

/** Compact tile; the unit sits in the label so long live numbers keep the full width on phones. */
function Mini({ label, unit, children }: { label: string; unit?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/80 bg-bg/40 p-3.5">
      <p className="eyebrow truncate">
        {label}
        {unit ? <span className="text-muted/70"> · {unit}</span> : null}
      </p>
      <p className="mt-1.5 truncate font-mono text-base font-semibold tabular-nums sm:text-lg">{children}</p>
    </div>
  )
}

const FORMULAS: readonly { name: string; formula: string }[] = [
  { name: 'Interest (savings and debt)', formula: 'principal × APR × seconds elapsed / (365 days)' },
  { name: 'ETH price', formula: 'VLAD reserve / ETH reserve of the Stellar AMM pool' },
  { name: 'Collateral value', formula: 'collateral ETH × ETH price' },
  { name: 'Max borrow', formula: 'collateral value × 50%' },
  { name: 'Health factor', formula: 'collateral value × 75% / debt' },
  { name: 'Liquidation price', formula: 'debt / (collateral ETH × 75%)' },
  { name: 'ETH to the liquidator', formula: 'min(collateral, debt × 110% / ETH price)' },
]

function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" className="card overflow-hidden p-5 sm:p-7">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.25fr] lg:gap-10">
        <div className="min-w-0">
          <p className="eyebrow">How it works</p>
          <h2 id="how-it-works" className="mt-2 text-2xl font-semibold sm:text-3xl">
            Rules of the bank
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Savers fund the bank with VLAD. Borrowers lock ETH and draw VLAD from that pool of savings. Savings interest is
            minted by the bank; borrow interest is paid back by borrowers and stays in the bank as extra liquidity.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { k: 'LTV', v: '50%', d: 'max borrow' },
              { k: 'Limit', v: '75%', d: 'liquidation threshold' },
              { k: 'Bonus', v: '10%', d: 'to liquidators' },
            ].map((p) => (
              <div key={p.k} className="min-w-0 rounded-2xl border border-border/80 bg-bg/40 p-3 sm:p-4">
                <p className="eyebrow truncate">{p.k}</p>
                <p className="mt-1 font-mono text-xl font-semibold text-accent-2 sm:text-2xl">{p.v}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted">{p.d}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 rounded-xl border border-warning/30 bg-warning/[0.06] px-3.5 py-3 text-sm leading-relaxed text-warning">
            Price = AMM spot from Stellar-LP-Staking with a same-block guard; demo oracle, production would use
            Chainlink/TWAP.
          </p>
          {DEPLOYED ? (
            <a
              className="link mt-4 inline-flex items-center gap-1 text-sm"
              href={explorerAddressUrl(addresses.bank)}
              target="_blank"
              rel="noreferrer"
            >
              StellarBank on Blockscout <ExternalIcon />
            </a>
          ) : null}
        </div>

        <dl className="min-w-0 divide-y divide-border/70 self-start rounded-2xl border border-border/80 bg-bg/40">
          {FORMULAS.map((f) => (
            <div key={f.name} className="px-4 py-3">
              <dt className="text-xs text-muted">{f.name}</dt>
              <dd className="mt-1 break-words font-mono text-sm text-text">{f.formula}</dd>
            </div>
          ))}
          <div className="px-4 py-3">
            <dt className="text-xs text-muted">Same-block guard</dt>
            <dd className="mt-1 text-sm leading-relaxed text-text">
              Borrowing, liquidating and withdrawing collateral with debt revert when the pool price changed in the current
              block, so a swap cannot move the price and use it in the same transaction.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
