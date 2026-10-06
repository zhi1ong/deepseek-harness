/** Composer dock pill for the API-key DeepSeek wallet balance. */

import { memo } from 'react'
import { IconWalletOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ApiBalanceView } from '@deepseek-ai/dsh-api-account-controller/types'
import type { BalanceInjected } from '../contract/slots.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { DialogPill } from './StatsPills.tsx'
import dialogCss from './stat-dialog.module.css'

/** DeepSeek provider routes whose sessions show the wallet pill. */
const OFFICIAL_PROVIDERS: ReadonlySet<string> = new Set(['deepseek-official', 'deepseek-account'])

/**
 * Prefix one wallet currency code with its display symbol.
 * @param currency - wallet currency code from the platform.
 * @returns the symbol (or the code itself followed by a space).
 */
const currencyPrefix = (currency: string): string =>
  currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `

/**
 * Display one wallet amount: the currency prefix plus the platform's exact
 * string, so the reading never round-trips through float formatting.
 * @param view - the wallet reading.
 * @returns display text, e.g. `¥110.00`.
 */
const formatAmount = (view: ApiBalanceView): string => `${currencyPrefix(view.currency)}${view.total}`

/**
 * Wall-clock time of one reading.
 * @param fetchedAt - epoch milliseconds of the successful read.
 * @returns local `HH:mm:ss`.
 */
const formatUpdatedAt = (fetchedAt: number): string => {
  const pad = (value: number): string => `${value}`.padStart(2, '0')
  const date = new Date(fetchedAt)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Props of the balance pill: the injected reading plus the dock's standard seats. */
export interface BalancePillProps extends InjectFace<BalanceInjected> {
  useProjection: UseProjection
  /** The owning dock's locale seat. */
  t: ChatViewSlotProps['t']
}

/**
 * Wallet-balance pill under the composer, opening the wallet breakdown
 * dialog.
 * @param props - the injected reading plus the standard dock seats.
 * @returns the pill and, while open, its portaled dialog; null while the
 * session's selected model is off the official DeepSeek routes or no reading
 * has arrived.
 */
export const BalancePill = memo(function BalancePill({ useBalance, useProjection, t }: BalancePillProps) {
  const provider = useProjection('modelSelection', view => view?.next?.provider)
  const balance = useBalance(value => value)
  if (provider === undefined || !OFFICIAL_PROVIDERS.has(provider)) return null
  if (balance === null) return null
  const icon = <IconWalletOutlineRegular />
  const amount = formatAmount(balance)
  const label = t('stats.balance', { amount })
  return (
    <DialogPill
      stat="balance"
      icon={icon}
      label={label}
      ariaLabel={label}
      title={t('stats.dialog.balanceTitle')}
      titleValue={amount}
    >
      <dl className={dialogCss.details} data-balance-details>
        <dt>{t('stats.dialog.balanceTotal')}</dt>
        <dd>
          {amount}
          {!balance.isAvailable && (
            <span className={dialogCss.reasoning}>{t('stats.dialog.balanceUnavailable')}</span>
          )}
        </dd>
        <dt>{t('stats.dialog.balanceToppedUp')}</dt>
        <dd>{balance.toppedUp ?? '—'}</dd>
        <dt>{t('stats.dialog.balanceGranted')}</dt>
        <dd>{balance.granted ?? '—'}</dd>
        <dt>{t('stats.dialog.balanceUpdated')}</dt>
        <dd>{formatUpdatedAt(balance.fetchedAt)}</dd>
      </dl>
    </DialogPill>
  )
})
