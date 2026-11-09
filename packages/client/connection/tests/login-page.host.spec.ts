/** Token login page markup, language choice, and Content Security Policy. */

import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { LOGIN_PAGE_CONTENT_SECURITY_POLICY, loginPageLocale, renderLoginPage } from '../src/login-page.ts'

function inlineHash(page: string, element: 'style' | 'script'): string {
  const match = new RegExp(`<${element}>([\\s\\S]*?)</${element}>`).exec(page)
  if (match?.[1] === undefined) throw new Error(`login page has no inline ${element}`)
  return `'sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}'`
}

describe('login page', () => {
  it('submits the token to the root exchange as a GET query', () => {
    const page = renderLoginPage({ locale: 'en', invalid: false, rememberDays: 365 })
    expect(page).toContain('<form method="get" action="./"')
    expect(page).toContain('name="token" type="password" required')
    expect(page).toContain('this device stays signed in for 365 days')
    expect(page).not.toContain('aria-invalid="true"')
    expect(page).not.toContain('role="alert"')
  })

  it('replaces the login page entry instead of adding one when the form submits', () => {
    const page = renderLoginPage({ locale: 'en', invalid: false, rememberDays: 30 })
    const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1]
    if (script === undefined) throw new Error('login page has no inline script')
    type Listener = (event: { preventDefault: () => void }) => void
    const listeners = new Map<string, Listener>()
    const form = { addEventListener: (type: string, listener: Listener) => { listeners.set(type, listener) } }
    const input = { type: 'password', value: 'a b&c/=', form, focus: () => undefined }
    const reveal = { addEventListener: () => undefined, setAttribute: () => undefined, dataset: {} }
    const document = { getElementById: (id: string) => id === 'token' ? input : reveal }
    const replaced: string[] = []
    const location = { replace: (url: string) => { replaced.push(url) } }
    // The inline script runs against these stand-ins for the page's own DOM and location.
    runInNewContext(script, { document, location, encodeURIComponent })
    let prevented = false
    listeners.get('submit')?.({ preventDefault: () => { prevented = true } })
    expect(prevented).toBe(true)
    expect(replaced).toEqual(['./?token=a%20b%26c%2F%3D'])
  })

  it('marks the field invalid and announces the error only for a refused token', () => {
    const page = renderLoginPage({ locale: 'zh', invalid: true, rememberDays: 30 })
    expect(page).toContain('<html lang="zh-CN">')
    expect(page).toContain('aria-invalid="true" aria-describedby="token-error"')
    expect(page).toContain('<p class="error" id="token-error" role="alert">')
    expect(page).toContain('令牌无效，请检查后重试。')
  })

  it('allows exactly its own inline stylesheet and script', () => {
    for (const page of [
      renderLoginPage({ locale: 'en', invalid: false, rememberDays: 365 }),
      renderLoginPage({ locale: 'zh', invalid: true, rememberDays: 1 }),
    ]) {
      expect(LOGIN_PAGE_CONTENT_SECURITY_POLICY).toContain(`style-src ${inlineHash(page, 'style')}`)
      expect(LOGIN_PAGE_CONTENT_SECURITY_POLICY).toContain(`script-src ${inlineHash(page, 'script')}`)
      expect(page).not.toMatch(/\sstyle="/)
    }
    expect(LOGIN_PAGE_CONTENT_SECURITY_POLICY).toContain("default-src 'none'")
    expect(LOGIN_PAGE_CONTENT_SECURITY_POLICY).toContain("form-action 'self'")
  })

  it.each([
    [undefined, 'en'],
    ['', 'en'],
    ['zh-CN,zh;q=0.9,en;q=0.8', 'zh'],
    ['en-US,en;q=0.9,zh-CN;q=0.8', 'en'],
    ['en;q=0.5,zh-TW;q=0.9', 'zh'],
    ['zh;q=0, en', 'en'],
    ['zh;q=abc, en', 'en'],
    ['en, zh', 'en'],
    ['zh-TW, en', 'zh'],
    ['fr-FR,fr;q=0.9', 'en'],
    ['ZH-hans', 'zh'],
  ] as const)('chooses %j as %s', (header, locale) => {
    expect(loginPageLocale(header)).toBe(locale)
  })
})
