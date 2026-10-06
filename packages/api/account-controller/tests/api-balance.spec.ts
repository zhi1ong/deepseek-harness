/** API-key balance route gating, wallet picking, and read caching. */
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountController from '../src/index.ts'
import { ApiBalanceReader, parseApiBalance } from '../src/api-balance.ts'
import type { ApiBalanceView } from '../src/types.ts'

const roots: Context[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

interface FixtureOptions {
  /** Registered configurable providers; defaults to the official route. */
  providers?: Array<{ provider: string; displayName: string; settingsNs: string; settingsPath: string[] }>
  /** Settings-described profile value of the `llm-deepseek` namespace. */
  profile?: unknown
  /** Credential-info outcome for the key reference. */
  configured?: boolean
  /** Resolved credential for the key reference; null resolves nothing. */
  resolved?: ResolvedCredential | null
  /** Launch-environment readings, by variable name. */
  environment?: Record<string, string>
}

function fixture(options: FixtureOptions = {}) {
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('llm', {
    listConfigurableProviders: vi.fn().mockReturnValue(options.providers ?? [
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
    ]),
  } as never)
  ctx.provide('settings', {
    describe: vi.fn().mockReturnValue([{ ns: 'llm-deepseek', value: options.profile === undefined ? { apiKeyEnv: 'DEEPSEEK_API_KEY' } : options.profile }]),
  } as never)
  const info: CredentialInfo = options.configured === false ? { configured: false, writable: true } : { configured: true, source: 'env', writable: true }
  ctx.provide('credentials', {
    describe: vi.fn<CredentialProviderStub['describe']>().mockResolvedValue(info),
    resolve: vi.fn<CredentialProviderStub['resolve']>().mockResolvedValue(
      options.resolved === null ? undefined : options.resolved ?? { value: 'sk-test-key', source: 'env' },
    ),
  } as never)
  ctx.provide('launchEnvironment', {
    get: vi.fn((name: string) => options.environment?.[name] === undefined ? undefined : { value: options.environment[name], source: 'process' }),
  } as never)
  const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>()
  vi.stubGlobal('fetch', fetchMock)
  return { ctx, fetchMock, reader: new ApiBalanceReader(ctx) }
}

type CredentialProviderStub = {
  describe: (ref: CredentialRef) => Promise<CredentialInfo>
  resolve: (ref: CredentialRef) => Promise<ResolvedCredential | undefined>
}

const okResponse = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const CNY_WALLET = {
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
}

describe('parseApiBalance', () => {
  it('picks the funded CNY wallet before any other wallet', () => {
    const usdFirst = parseApiBalance({
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: '5.00' }, { currency: 'CNY', total_balance: '7.00' }],
    }, 1)
    expect(usdFirst).toMatchObject({ currency: 'CNY', total: '7.00' })
    const fundedOnly = parseApiBalance({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '0.00' }, { currency: 'USD', total_balance: '5.00' }],
    }, 1)
    expect(fundedOnly).toMatchObject({ currency: 'USD', total: '5.00' })
    const anyCny = parseApiBalance({ balance_infos: [{ currency: 'EUR', total_balance: '0.00' }, { currency: 'CNY', total_balance: '0.00' }] }, 1)
    expect(anyCny).toMatchObject({ currency: 'CNY', total: '0.00' })
  })

  it('keeps omitted wallet components null and reflects availability', () => {
    const view = parseApiBalance({ is_available: false, balance_infos: [{ currency: 'CNY', total_balance: '0.00' }] }, 5)
    expect(view).toEqual({ currency: 'CNY', total: '0.00', granted: null, toppedUp: null, isAvailable: false, fetchedAt: 5 })
  })

  it('rejects bodies without a valid wallet', () => {
    expect(parseApiBalance(null, 1)).toBeNull()
    expect(parseApiBalance({ balance_infos: 'nope' }, 1)).toBeNull()
    expect(parseApiBalance({ balance_infos: [] }, 1)).toBeNull()
    expect(parseApiBalance({ balance_infos: [null, 42] }, 1)).toBeNull()
    expect(parseApiBalance({ balance_infos: [{ currency: 'CNY', total_balance: 'not-a-number' }] }, 1)).toBeNull()
    // A null entry between valid wallets is skipped, not fatal.
    expect(parseApiBalance({ balance_infos: [null, { currency: 'CNY', total_balance: '1.00' }] }, 1))
      .toMatchObject({ total: '1.00' })
  })
})

describe('ApiBalanceReader route gates', () => {
  it('reads null while the official provider is absent', async () => {
    const { fetchMock, reader } = fixture({ providers: [] })
    expect(await reader.read()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads null while the key reference is unconfigured', async () => {
    const { fetchMock, reader } = fixture({ configured: false })
    expect(await reader.read()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads null while the key reference resolves no value', async () => {
    const { fetchMock, reader } = fixture({ resolved: null })
    expect(await reader.read()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads null for a gateway baseURL set in settings', async () => {
    const { fetchMock, reader } = fixture({ profile: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://gw.example.com/anthropic' } })
    expect(await reader.read()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads null for a gateway baseURL set in the launch environment', async () => {
    const { fetchMock, reader } = fixture({ environment: { DEEPSEEK_BASE_URL: 'https://gw.example.com' } })
    expect(await reader.read()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads null for profile shapes that carry no usable key reference', async () => {
    for (const profile of [null, {}, { apiKeyEnv: '' }]) {
      const { fetchMock, reader } = fixture({ profile })
      expect(await reader.read()).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('reads null while the settings namespace is missing or the path walk misses', async () => {
    const absent = fixture({
      providers: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-other', settingsPath: [] }],
    })
    expect(await absent.reader.read()).toBeNull()
    expect(absent.fetchMock).not.toHaveBeenCalled()
    const deep = fixture({
      providers: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: ['deepseek'] }],
      profile: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
    })
    deep.fetchMock.mockResolvedValue(okResponse(CNY_WALLET))
    expect(await deep.reader.read()).toMatchObject({ total: '110.00' })
    const missed = fixture({
      providers: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: ['a', 'b'] }],
      profile: { a: 42 },
    })
    expect(await missed.reader.read()).toBeNull()
    expect(missed.fetchMock).not.toHaveBeenCalled()
  })

  it('reads null while the settings or credentials service is absent', async () => {
    const providers = [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }]
    const absentBoth = new Context()
    roots.push(absentBoth)
    absentBoth.provide('llm', { listConfigurableProviders: vi.fn().mockReturnValue(providers) } as never)
    vi.stubGlobal('fetch', vi.fn())
    expect(await new ApiBalanceReader(absentBoth).read()).toBeNull()
    const absentCredentials = new Context()
    roots.push(absentCredentials)
    absentCredentials.provide('llm', { listConfigurableProviders: vi.fn().mockReturnValue(providers) } as never)
    absentCredentials.provide('settings', {
      describe: vi.fn().mockReturnValue([{ ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY' } }]),
    } as never)
    expect(await new ApiBalanceReader(absentCredentials).read()).toBeNull()
  })
})

describe('ApiBalanceReader reads', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }) })

  it('treats an empty baseURL setting as unset and reads the official endpoint', async () => {
    const { fetchMock, reader } = fixture({ profile: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: '' } })
    fetchMock.mockResolvedValue(okResponse(CNY_WALLET))
    expect(await reader.read()).toMatchObject({ total: '110.00' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetches the official balance endpoint with the resolved key', async () => {
    const { fetchMock, reader } = fixture()
    fetchMock.mockResolvedValue(okResponse(CNY_WALLET))
    const view = await reader.read()
    expect(view).toMatchObject({ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00', isAvailable: true })
    expect(view?.fetchedAt).toBeTypeOf('number')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    if (call === undefined) throw new Error('balance fetch not called')
    const [url, init] = call
    expect(url).toBe('https://api.deepseek.com/user/balance')
    expect(init.headers).toEqual({ authorization: 'Bearer sk-test-key' })
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('serves one reading for the TTL window and re-fetches past it', async () => {
    const { fetchMock, reader } = fixture()
    fetchMock.mockResolvedValue(okResponse(CNY_WALLET))
    await reader.read()
    vi.advanceTimersByTime(4_000)
    await reader.read()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(6_000)
    fetchMock.mockResolvedValue(okResponse({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '99.00' }] }))
    expect(await reader.read()).toMatchObject({ total: '99.00' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent reads into one in-flight fetch', async () => {
    const { fetchMock, reader } = fixture()
    const pending: Array<(response: Response) => void> = []
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { pending.push(resolve) }))
    const first = reader.read()
    const second = reader.read()
    await vi.waitFor(() => { if (pending.length === 0) throw new Error('fetch not started') })
    expect(pending.length).toBe(1)
    const release = pending[0]
    if (release === undefined) throw new Error('fetch not started')
    release(okResponse(CNY_WALLET))
    expect(await first).toMatchObject({ total: '110.00' })
    expect(await second).toMatchObject({ total: '110.00' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the last successful reading when a later fetch fails', async () => {
    const { fetchMock, reader } = fixture()
    fetchMock.mockResolvedValueOnce(okResponse(CNY_WALLET))
    const good = await reader.read()
    vi.advanceTimersByTime(10_000)
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    expect(await reader.read()).toBe(good)
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect(await reader.read()).toBe(good)
  })

  it('reads null when a first fetch fails with nothing to keep', async () => {
    const { fetchMock, reader } = fixture()
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect(await reader.read()).toBeNull()
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    expect(await reader.read()).toBeNull()
    fetchMock.mockResolvedValueOnce(okResponse({ balance_infos: 'malformed' }))
    expect(await reader.read()).toBeNull()
  })

  it('re-reads within the TTL window after a route input changes', async () => {
    const { ctx, fetchMock, reader } = fixture()
    fetchMock.mockResolvedValue(okResponse(CNY_WALLET))
    await reader.read()
    const body = (): Response => okResponse({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '120.00' }] })
    ctx.emit('credentials/reference-updated', credentialRef('DEEPSEEK_API_KEY'))
    fetchMock.mockResolvedValueOnce(body())
    expect(await reader.read()).toMatchObject({ total: '120.00' })
    ctx.emit('llm/adapters-updated')
    fetchMock.mockResolvedValueOnce(body())
    expect(await reader.read()).toMatchObject({ total: '120.00' })
    ctx.emit('settings/document-updated', 'llm-deepseek' as never, 1)
    fetchMock.mockResolvedValueOnce(body())
    expect(await reader.read()).toMatchObject({ total: '120.00' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('AccountController.getApiBalance', () => {
  it('delegates to the reader over the same gates', async () => {
    const { ctx, fetchMock } = fixture()
    fetchMock.mockResolvedValue(okResponse(CNY_WALLET))
    const controller = new AccountController(ctx)
    const view: ApiBalanceView | null = await controller.getApiBalance()
    expect(view).toMatchObject({ currency: 'CNY', total: '110.00' })
  })
})
