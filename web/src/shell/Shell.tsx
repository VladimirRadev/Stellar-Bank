import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useConnection, useSwitchChain } from 'wagmi'
import { CHAIN_ID, footerContracts } from '../config/addresses'
import { explorerAddressUrl, formatToken, isConfiguredAddress, truncateAddress } from './format'
import { ArrowIcon, ExternalIcon, GithubIcon, StarGlyph } from './icons'
import { CURRENT_SITE, GITHUB_PROFILE, SITES, currentSite, getSite } from './sites'
import { useVladBalance } from './useVladBalance'
import { WalletButton } from './WalletButton'

/** Page frame shared by all Stellar apps: top navigation, faucet hint, main content, footer. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Sticky only from md up: on phones the three header rows would take too much height. */}
      <header className="z-40 border-b border-border/70 bg-bg/75 backdrop-blur-xl md:sticky md:top-0">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex h-14 min-w-0 items-center gap-3 md:h-16">
            <Brand />
            <div className="ml-auto hidden items-center gap-2 md:flex">
              <VladBalanceChip />
              <NetworkBadge />
            </div>
            <div className="ml-auto shrink-0 md:ml-0">
              <WalletButton />
            </div>
          </div>

          <SuiteNav />
        </div>

        <MobileStatusRow />
      </header>

      <FaucetHint />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>

      <Footer />
    </div>
  )
}

/** useLayoutEffect in the browser, useEffect where there is no DOM (SSR or prerender), so React never warns. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Width in px of the fade at an edge of the nav row that has more tabs hidden behind it. */
const NAV_FADE_PX = 24

/**
 * One row of all suite apps at every width. It scrolls inside itself, never the page.
 * On narrow screens the row is wider than the viewport, so on mount it scrolls the active tab
 * into view, and each edge that hides more tabs fades out to show that the row scrolls.
 */
function SuiteNav() {
  const navRef = useRef<HTMLElement>(null)
  const activeRef = useRef<HTMLAnchorElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })

  useIsomorphicLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return

    const updateFade = () => {
      const maxScroll = nav.scrollWidth - nav.clientWidth
      const left = nav.scrollLeft > 1
      const right = nav.scrollLeft < maxScroll - 1
      setFade((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
    }

    // Scroll only the nav row: Element.scrollIntoView would also scroll the page vertically on
    // phones, where the header is not sticky. The jump is instant (never animated), so it runs
    // before first paint and needs no prefers-reduced-motion check. The target keeps the active
    // tab NAV_FADE_PX clear of each edge fade; the browser clamps scrollLeft to the valid range.
    const revealActive = () => {
      const link = activeRef.current
      if (link) {
        const navBox = nav.getBoundingClientRect()
        const linkBox = link.getBoundingClientRect()
        const pastRight = linkBox.right - (navBox.right - NAV_FADE_PX)
        const pastLeft = navBox.left + NAV_FADE_PX - linkBox.left
        if (pastRight > 0) nav.scrollLeft += pastRight
        else if (pastLeft > 0) nav.scrollLeft -= pastLeft
      }
      updateFade()
    }

    revealActive()
    // The web fonts load after first paint and change the tab widths: measure once more when ready.
    let disposed = false
    document.fonts?.ready.then(() => {
      if (!disposed) revealActive()
    })
    nav.addEventListener('scroll', updateFade, { passive: true })
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateFade)
    resize?.observe(nav)
    return () => {
      disposed = true
      nav.removeEventListener('scroll', updateFade)
      resize?.disconnect()
    }
  }, [])

  const stops = [
    ...(fade.left ? ['transparent', `black ${NAV_FADE_PX}px`] : ['black']),
    ...(fade.right ? [`black calc(100% - ${NAV_FADE_PX}px)`, 'transparent'] : ['black']),
  ]
  const mask = fade.left || fade.right ? `linear-gradient(to right, ${stops.join(', ')})` : undefined

  return (
    <nav
      ref={navRef}
      aria-label="Stellar apps"
      className="-mb-px flex min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none] md:gap-1 [&::-webkit-scrollbar]:hidden"
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {SITES.map((site) => {
        const active = site.key === CURRENT_SITE
        return (
          <a
            key={site.key}
            ref={active ? activeRef : undefined}
            href={site.url}
            aria-current={active ? 'page' : undefined}
            title={site.tagline}
            className={`relative shrink-0 whitespace-nowrap px-2 pb-3 pt-1 text-[0.8125rem] font-medium transition md:px-3 md:text-sm ${
              active ? 'text-text' : 'text-muted hover:text-text'
            }`}
          >
            {site.navLabel}
            {active ? (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-lime via-accent-2 to-accent md:inset-x-3" />
            ) : null}
          </a>
        )
      })}
    </nav>
  )
}

/** Phones only, and only while a wallet is connected: VLAD balance + network badge under the nav. */
function MobileStatusRow() {
  const { isConnected } = useConnection()
  if (!isConnected) return null
  return (
    <div className="border-t border-border/50 md:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
        <VladBalanceChip />
        <NetworkBadge />
      </div>
    </div>
  )
}

function Brand() {
  return (
    <a href={getSite('faucet').url} className="flex min-w-0 items-center gap-2.5" aria-label="Stellar suite home">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-surface-2/80 shadow-[0_0_24px_-6px_rgb(16_185_129/0.6)]">
        <StarGlyph size={18} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-display text-[0.95rem] font-bold tracking-[0.22em] text-text">STELLAR</span>
        <span className="hidden truncate text-[0.7rem] text-muted sm:block">personal Web3 suite · Sepolia</span>
      </span>
    </a>
  )
}

function VladBalanceChip() {
  const { isConnected } = useConnection()
  const { balance, isLoading } = useVladBalance()
  if (!isConnected) return null
  return (
    <span className="chip" title="Your VLAD balance">
      <StarGlyph size={13} />
      {isLoading ? <span className="skeleton h-3.5 w-12" /> : <span className="font-mono">{formatToken(balance)}</span>}
      <span className="text-muted">VLAD</span>
    </span>
  )
}

function NetworkBadge() {
  const { isConnected, chainId } = useConnection()
  const switchChain = useSwitchChain()
  if (isConnected && chainId !== CHAIN_ID) {
    return (
      <button
        type="button"
        className="chip border-warning/40 text-warning hover:border-warning"
        onClick={() => switchChain.mutate({ chainId: CHAIN_ID })}
        disabled={switchChain.isPending}
      >
        <span className="size-2 rounded-full bg-warning" aria-hidden />
        Wrong network · switch
      </button>
    )
  }
  return (
    <span className="chip">
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-2 opacity-50" />
        <span className="relative inline-flex size-2 rounded-full bg-accent-2" />
      </span>
      Sepolia
    </span>
  )
}

/** Shown under the header when the connected wallet holds 0 VLAD. */
function FaucetHint() {
  const { balance } = useVladBalance()
  if (balance === undefined || balance > 0n) return null
  const onFaucet = CURRENT_SITE === 'faucet'
  return (
    <div className="border-b border-accent/20 bg-accent/[0.07]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-6">
        <span className="text-text">You have 0 VLAD.</span>
        <a className="link inline-flex items-center gap-1 font-medium" href={onFaucet ? '#claim' : getSite('faucet').url}>
          Get VLAD at the Faucet <ArrowIcon size={14} />
        </a>
      </div>
    </div>
  )
}

function Footer() {
  return (
    <footer className="mt-12 border-t border-border/70 bg-bg/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <StarGlyph size={16} />
            <span className="font-display text-sm font-bold tracking-[0.22em]">STELLAR</span>
          </div>
          <p className="mt-3 max-w-sm text-sm text-muted">
            Stellar is a personal Web3 portfolio suite on the Ethereum Sepolia testnet. Testnet tokens have no monetary
            value.
          </p>
          <p className="mt-2 max-w-sm text-xs text-muted/80">
            Stellar is a personal portfolio brand, unrelated to the Stellar (XLM) network.
          </p>
        </div>

        <div className="min-w-0">
          <p className="eyebrow">Contracts · {currentSite.name}</p>
          <ul className="mt-3 space-y-2">
            {footerContracts.map((c) => (
              <li key={c.label} className="flex min-w-0 flex-col">
                <span className="text-xs text-muted">{c.label}</span>
                {isConfiguredAddress(c.address) ? (
                  <a
                    className="link inline-flex min-w-0 items-center gap-1 font-mono text-sm"
                    href={explorerAddressUrl(c.address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {truncateAddress(c.address, 8, 6)} <ExternalIcon />
                  </a>
                ) : (
                  <span className="font-mono text-sm text-muted">not deployed yet</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="eyebrow">Links</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a className="link inline-flex items-center gap-1.5" href={currentSite.repo} target="_blank" rel="noreferrer">
                <GithubIcon /> Source on GitHub
              </a>
            </li>
            <li>
              <a className="link inline-flex items-center gap-1.5" href={GITHUB_PROFILE} target="_blank" rel="noreferrer">
                Built by Vladimir Radev <ExternalIcon />
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
