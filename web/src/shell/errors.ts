import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  keccak256,
  stringToHex,
  zeroHash,
  type Abi,
} from 'viem'
import { formatTimestamp, truncateAddress } from './format'

/** Maps a custom error name to a readable sentence. Receives the decoded error arguments. */
export type ErrorMessages = Record<string, (args: readonly unknown[]) => string>

/**
 * OpenZeppelin v5 custom errors that often bubble up from a *different* contract than the one
 * called (for example the token reverting inside faucet.claim()). TxButton merges this list into
 * the ABI used for simulation so viem can decode these reverts too.
 */
export const COMMON_ERRORS_ABI = [
  { type: 'error', name: 'AccessControlUnauthorizedAccount', inputs: [{ name: 'account', type: 'address' }, { name: 'neededRole', type: 'bytes32' }] },
  { type: 'error', name: 'OwnableUnauthorizedAccount', inputs: [{ name: 'account', type: 'address' }] },
  { type: 'error', name: 'ERC20InsufficientBalance', inputs: [{ name: 'sender', type: 'address' }, { name: 'balance', type: 'uint256' }, { name: 'needed', type: 'uint256' }] },
  { type: 'error', name: 'ERC20InsufficientAllowance', inputs: [{ name: 'spender', type: 'address' }, { name: 'allowance', type: 'uint256' }, { name: 'needed', type: 'uint256' }] },
  { type: 'error', name: 'ERC20InvalidReceiver', inputs: [{ name: 'receiver', type: 'address' }] },
  { type: 'error', name: 'ERC20InvalidSender', inputs: [{ name: 'sender', type: 'address' }] },
  { type: 'error', name: 'ERC20InvalidSpender', inputs: [{ name: 'spender', type: 'address' }] },
  { type: 'error', name: 'SafeERC20FailedOperation', inputs: [{ name: 'token', type: 'address' }] },
  { type: 'error', name: 'ReentrancyGuardReentrantCall', inputs: [] },
  { type: 'error', name: 'EnforcedPause', inputs: [] },
  { type: 'error', name: 'ExpectedPause', inputs: [] },
] as const satisfies Abi

const KNOWN_ROLES: Record<string, string> = {
  [zeroHash]: 'DEFAULT_ADMIN_ROLE',
  [keccak256(stringToHex('MINTER_ROLE'))]: 'MINTER_ROLE',
}

const roleName = (role: unknown) => KNOWN_ROLES[String(role)] ?? truncateAddress(String(role), 10, 6)

/** Readable defaults for common errors. Apps pass their own map to TxButton to extend or override. */
export const DEFAULT_ERROR_MESSAGES: ErrorMessages = {
  AccessControlUnauthorizedAccount: ([account, role]) =>
    `${truncateAddress(String(account))} is missing the ${roleName(role)} role.`,
  OwnableUnauthorizedAccount: () => 'Only the contract owner can do this.',
  ERC20InsufficientBalance: () => 'Insufficient VLAD balance.',
  ERC20InsufficientAllowance: () => 'Allowance too low: approve the token first.',
  ERC20InvalidReceiver: () => 'Invalid receiver address.',
  SafeERC20FailedOperation: () => 'Token transfer failed.',
  ReentrancyGuardReentrantCall: () => 'Reentrant call blocked.',
  EnforcedPause: () => 'The contract is paused.',
  // Common app-level names, so every app gets a readable sentence without extra wiring.
  CooldownActive: ([next]) => `Cooldown active: try again after ${formatTimestamp(next as bigint)}.`,
  FaucetPaused: () => 'The faucet is paused right now.',
}

/** Turns any wallet / RPC / revert error into one short readable sentence. */
export function describeError(error: unknown, messages: ErrorMessages = {}): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return 'You rejected the request in your wallet.'

    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name) {
        const describe = messages[name] ?? DEFAULT_ERROR_MESSAGES[name]
        return describe ? describe(reverted.data?.args ?? []) : `Transaction reverted: ${name}.`
      }
      if (reverted.reason) return `Transaction reverted: ${reverted.reason}`
      return 'Transaction would revert.'
    }
    return error.shortMessage || error.message
  }
  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 4001) {
    return 'You rejected the request in your wallet.'
  }
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
