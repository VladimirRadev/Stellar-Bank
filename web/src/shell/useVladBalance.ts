import { erc20Abi } from 'viem'
import { useConnection, useReadContract } from 'wagmi'
import { CHAIN_ID, addresses } from '../config/addresses'
import { isConfiguredAddress } from './format'

/** VLAD balance of the connected wallet (undefined while disconnected or loading). */
export function useVladBalance() {
  const { address } = useConnection()
  const enabled = !!address && isConfiguredAddress(addresses.vladToken)
  const query = useReadContract({
    address: addresses.vladToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled },
  })
  return { balance: enabled ? query.data : undefined, isLoading: enabled && query.isLoading }
}
