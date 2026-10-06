/** API-key DeepSeek wallet balance: route gating, fetch, and read caching. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type { ApiBalanceView } from './types.ts'

/** The provider route this reader serves; the id `llm-deepseek-api-key` registers. */
const PROVIDER = 'deepseek-official'
/** Official Messages endpoint root; mirrors `PUBLIC_BASE_URL` in dsh-llm-deepseek. */
const OFFICIAL_MESSAGES_BASE_URL = 'https://api.deepseek.com/anthropic'
/** Official platform root the `user/balance` endpoint lives on. */
const OFFICIAL_PLATFORM_ROOT = 'https://api.deepseek.com'
/** Environment variable the adapter reads its endpoint override from. */
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'
/** How long one successful reading serves before the next read re-fetches. */
const BALANCE_TTL_MS = 5000
/** Per-request timeout; bounds one turn-end refresh. */
const BALANCE_TIMEOUT_MS = 8000

/** One validated wallet entry from the platform `balance_infos` array. */
interface BalanceWallet {
  readonly currency: string
  readonly total: string
  readonly granted: string | null
  readonly toppedUp: string | null
}

/**
 * Validate one `balance_infos` entry.
 * @param raw - one array element of the response body.
 * @returns the wallet with string amounts, or null when it fails validation.
 */
const walletOf = (raw: unknown): BalanceWallet | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const currency: unknown = Reflect.get(raw, 'currency')
  const total: unknown = Reflect.get(raw, 'total_balance')
  if (typeof currency !== 'string' || typeof total !== 'string' || !Number.isFinite(Number(total))) return null
  const optional = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  return {
    currency,
    total,
    granted: optional(Reflect.get(raw, 'granted_balance')),
    toppedUp: optional(Reflect.get(raw, 'topped_up_balance')),
  }
}

/**
 * Reduce a Messages endpoint URL to the platform root it serves.
 * @param baseURL - configured or ambient Messages base URL.
 * @returns the root without trailing slashes or the `/anthropic` route suffix.
 */
const platformRootOf = (baseURL: string): string => baseURL.replace(/\/+$/, '').replace(/\/anthropic$/, '')

/**
 * Map the platform `GET /user/balance` body into one display view.
 * @param raw - parsed response body.
 * @param fetchedAt - epoch milliseconds to stamp on the view.
 * @returns the picked wallet view, or null when the body carries no valid wallet.
 */
export function parseApiBalance(raw: unknown, fetchedAt: number): ApiBalanceView | null {
  if (typeof raw !== 'object' || raw === null) return null
  const infos: unknown = Reflect.get(raw, 'balance_infos')
  if (!Array.isArray(infos)) return null
  const wallets = infos.map(walletOf).filter((wallet): wallet is BalanceWallet => wallet !== null)
  // The wallet the pill reports: a funded CNY wallet first, then any funded
  // wallet, then CNY, then whatever the platform returned at all.
  const pick = wallets.find(wallet => wallet.currency === 'CNY' && Number(wallet.total) > 0)
    ?? wallets.find(wallet => Number(wallet.total) > 0)
    ?? wallets.find(wallet => wallet.currency === 'CNY')
    ?? wallets.at(0)
  if (pick === undefined) return null
  return {
    currency: pick.currency,
    total: pick.total,
    granted: pick.granted,
    toppedUp: pick.toppedUp,
    isAvailable: Reflect.get(raw, 'is_available') === true,
    fetchedAt,
  }
}

/**
 * Reads the platform wallet balance over the official API-key route. Readings
 * dedupe in flight, a fresh success serves for the TTL window, and a failed
 * re-fetch keeps the last success so the display degrades instead of
 * flickering away. The reading is null — never an error — whenever a route
 * gate fails: the official provider is absent, its key reference is
 * unconfigured, or its endpoint points at a custom gateway.
 */
export class ApiBalanceReader {
  private inflight: Promise<ApiBalanceView | null> | undefined
  private lastGood: ApiBalanceView | undefined
  private lastGoodAt = 0

  /**
   * @param ctx - Host root context carrying the LLM, settings, and credentials services.
   */
  constructor(private readonly ctx: Context) {
    // Each of these events can change a route gate or the key value, so each
    // drops the cached reading and the next read re-runs them.
    ctx.on('credentials/reference-updated', () => { this.dropCache() })
    ctx.on('llm/adapters-updated', () => { this.dropCache() })
    ctx.on('settings/document-updated', () => { this.dropCache() })
  }

  /**
   * Read the current wallet balance, reusing a fresh reading or the in-flight one.
   * @returns the latest view, the last success while a new fetch fails, or null while the route is not configured or has never succeeded.
   */
  read(): Promise<ApiBalanceView | null> {
    if (this.inflight !== undefined) return this.inflight
    if (this.lastGood !== undefined && Date.now() - this.lastGoodAt < BALANCE_TTL_MS) {
      return Promise.resolve(this.lastGood)
    }
    const operation = this.fetch().finally(() => { this.inflight = undefined })
    this.inflight = operation
    return operation
  }

  private dropCache(): void {
    this.lastGood = undefined
    this.lastGoodAt = 0
  }

  private async fetch(): Promise<ApiBalanceView | null> {
    const key = await this.resolveKey()
    if (key === null) return null
    try {
      const response = await fetch(`${OFFICIAL_PLATFORM_ROOT}/user/balance`, {
        headers: { authorization: `Bearer ${key}` },
        redirect: 'error',
        signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
      })
      if (!response.ok) return this.lastGood ?? null
      const view = parseApiBalance(await response.json(), Date.now())
      if (view === null) return this.lastGood ?? null
      this.lastGood = view
      this.lastGoodAt = view.fetchedAt
      return view
    } catch (error) {
      // Timeout, network, and body-decode failures keep the last successful
      // reading; none of them carries the key, so the debug line is safe.
      this.ctx.logger.debug('account-controller: balance fetch failed', error)
      return this.lastGood ?? null
    }
  }

  /**
   * Run the route gates and resolve the current key value.
   * @returns the API key, or null while any gate fails.
   */
  private async resolveKey(): Promise<string | null> {
    const provider = this.ctx.llm.listConfigurableProviders().find(entry => entry.provider === PROVIDER)
    if (provider === undefined) return null
    const settings = this.ctx.get('settings')
    const credentials = this.ctx.get('credentials')
    if (settings === undefined || credentials === undefined) return null
    const namespaces = settings.describe({ redactSecrets: true })
    let profile: unknown = namespaces.find(namespace => namespace.ns === provider.settingsNs)?.value
    for (const segment of provider.settingsPath) {
      profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, segment) : undefined
    }
    if (typeof profile !== 'object' || profile === null) return null
    const apiKeyEnv: unknown = Reflect.get(profile, 'apiKeyEnv')
    if (typeof apiKeyEnv !== 'string' || apiKeyEnv.length === 0) return null
    const configured: unknown = Reflect.get(profile, 'baseURL')
    const endpoint = typeof configured === 'string' && configured.length > 0
      ? configured
      : launchEnvironmentOf(this.ctx).get(BASE_URL_ENV)?.value ?? OFFICIAL_MESSAGES_BASE_URL
    if (platformRootOf(endpoint) !== OFFICIAL_PLATFORM_ROOT) return null
    const ref = credentialRef(apiKeyEnv)
    if (!(await credentials.describe(ref)).configured) return null
    const hit = await credentials.resolve(ref)
    return hit !== undefined ? hit.value : null
  }
}
