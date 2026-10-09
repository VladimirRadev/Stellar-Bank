/**
 * The six apps of the Stellar suite. This file is identical in all five Stellar-* repos,
 * except for CURRENT_SITE at the bottom, which names the app this repo builds.
 */
export type SiteKey = 'faucet' | 'lp-staking' | 'bank' | 'store' | 'arena' | 'stellargon'

export type Site = {
  key: SiteKey
  /** Full name, used in cards and the footer. */
  name: string
  /** Short label for the top navigation. */
  navLabel: string
  /** One short line about what the app does. */
  tagline: string
  /** Absolute GitHub Pages URL (always ends with a slash). */
  url: string
  /** GitHub repository URL. */
  repo: string
}

export const GITHUB_PROFILE = 'https://github.com/VladimirRadev'
const PAGES_ROOT = 'https://vladimirradev.github.io'

export const SITES: readonly Site[] = [
  {
    key: 'faucet',
    name: 'Faucet',
    navLabel: 'Faucet',
    tagline: 'Claim free $VLAD on Sepolia',
    url: `${PAGES_ROOT}/Stellar-Faucet/`,
    repo: `${GITHUB_PROFILE}/Stellar-Faucet`,
  },
  {
    key: 'lp-staking',
    name: 'Swap & LP Staking',
    navLabel: 'Swap & Stake',
    tagline: 'Swap $VLAD and stake LP tokens for rewards',
    url: `${PAGES_ROOT}/Stellar-LP-Staking/`,
    repo: `${GITHUB_PROFILE}/Stellar-LP-Staking`,
  },
  {
    key: 'bank',
    name: 'Bank',
    navLabel: 'Bank',
    tagline: 'Deposit $VLAD and earn on-chain interest',
    url: `${PAGES_ROOT}/Stellar-Bank/`,
    repo: `${GITHUB_PROFILE}/Stellar-Bank`,
  },
  {
    key: 'store',
    name: 'Store',
    navLabel: 'Store',
    tagline: 'Spend $VLAD on on-chain items',
    url: `${PAGES_ROOT}/Stellar-Store/`,
    repo: `${GITHUB_PROFILE}/Stellar-Store`,
  },
  {
    key: 'arena',
    name: 'Arena',
    navLabel: 'Arena',
    tagline: 'Put $VLAD to play in on-chain games',
    url: `${PAGES_ROOT}/Stellar-Arena/`,
    repo: `${GITHUB_PROFILE}/Stellar-Arena`,
  },
  {
    key: 'stellargon',
    name: 'Stellargon',
    navLabel: 'Stellargon',
    tagline: 'Predict real-world events',
    url: `${PAGES_ROOT}/Stellargon/`,
    repo: `${GITHUB_PROFILE}/Stellargon`,
  },
]

export function getSite(key: SiteKey): Site {
  const site = SITES.find((s) => s.key === key)
  if (!site) throw new Error(`unknown site ${key}`)
  return site
}

/** The app this repo builds. The ONLY line in shell/ that changes per repo. */
export const CURRENT_SITE: SiteKey = 'bank'

export const currentSite: Site = getSite(CURRENT_SITE)
