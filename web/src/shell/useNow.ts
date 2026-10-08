import { useEffect, useState } from 'react'

/** Current unix time in seconds, re-rendering every `intervalMs`. Used for countdowns. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
