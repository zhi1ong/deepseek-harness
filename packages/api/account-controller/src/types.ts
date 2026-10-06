/** Account Remote values contain no credential payloads. */
export type { AccountBonusBatch, AccountBonusNotification, AccountBonusOrderId, AccountClientMetadata, AccountDetails, AccountProfile, AccountUserId, AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'

/** One API-key DeepSeek wallet balance reading, safe for Remote display. */
export interface ApiBalanceView {
  /** Wallet currency code from the platform, e.g. 'CNY' or 'USD'. */
  currency: string
  /** Total balance exactly as the platform reports it; kept a string so display never round-trips through float. */
  total: string
  /** Unexpired granted balance, or null when the platform omits the wallet component. */
  granted: string | null
  /** Recharge balance, or null when the platform omits the wallet component. */
  toppedUp: string | null
  /** Whether the platform reports balance available for API calls. */
  isAvailable: boolean
  /** Epoch milliseconds of the successful read this view came from. */
  fetchedAt: number
}
