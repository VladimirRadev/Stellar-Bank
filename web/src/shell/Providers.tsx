import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import { wagmiConfig } from './wagmi'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 4_000, refetchOnWindowFocus: true, retry: 2 },
  },
})

/** wagmi + TanStack Query providers. Wrap the whole app once (see App.tsx). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
