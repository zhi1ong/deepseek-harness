/**
 * Token login page served on unauthenticated index requests. Submitting the
 * form replaces the page with `./?token=...`, so the existing root token
 * exchange mints the cookie and redirects to clean `./`; the page itself
 * grants nothing. The replacement leaves no history entry for the login
 * page, so a saved home-screen app offers no back navigation to it. Without
 * the script the form performs the same GET as an ordinary navigation. The
 * page carries no user input back to the browser and loads no resource.
 */

import { createHash } from 'node:crypto'
import { LOGIN_WORDMARK_SVG } from './login-wordmark.ts'

/** Login page languages; `zh` for Chinese browsers, `en` otherwise. */
export type LoginPageLocale = 'zh' | 'en'

/** Inputs of one login page rendering. */
export interface LoginPageOptions {
  /** Page language. */
  readonly locale: LoginPageLocale
  /** Whether the request carried a token that failed the exchange. */
  readonly invalid: boolean
  /** Cookie lifetime the remember note states, in whole days. */
  readonly rememberDays: number
}

interface LoginPageCopy {
  readonly lang: string
  readonly title: string
  readonly description: string
  readonly label: string
  readonly placeholder: string
  readonly show: string
  readonly hide: string
  readonly submit: string
  readonly invalid: string
  readonly remember: (days: number) => string
  readonly helpSummary: string
  readonly help: string
}

const COPY: Readonly<Record<LoginPageLocale, LoginPageCopy>> = {
  zh: {
    lang: 'zh-CN',
    title: '输入访问令牌',
    description: '这个 DeepSeek Harness 需要访问令牌才能使用。',
    label: '访问令牌',
    placeholder: '粘贴访问令牌',
    show: '显示令牌',
    hide: '隐藏令牌',
    submit: '继续',
    invalid: '令牌无效，请检查后重试。',
    remember: days => `验证通过后，这台设备 ${String(days)} 天内无需再次输入。`,
    helpSummary: '在哪里找到令牌？',
    help: '令牌是部署者设置的 <code>DSH_LAUNCH_TOKEN</code>，也是服务日志中登录链接里 <code>?token=</code> 后面的部分。请向部署者索取。',
  },
  en: {
    lang: 'en',
    title: 'Enter access token',
    description: 'This DeepSeek Harness requires an access token.',
    label: 'Access token',
    placeholder: 'Paste the access token',
    show: 'Show token',
    hide: 'Hide token',
    submit: 'Continue',
    invalid: 'Invalid token. Check it and try again.',
    remember: days => `After verification, this device stays signed in for ${String(days)} days.`,
    helpSummary: 'Where do I find the token?',
    help: 'The token is the <code>DSH_LAUNCH_TOKEN</code> set by whoever deployed this server, and the part after <code>?token=</code> in the login link printed in the server log. Ask them for it.',
  },
}

const DARK_TOKENS = '--dsw-alias-label-primary-inverted:#353638;--bg:#151517;--layer:#2c2c2e;--border:rgba(255,255,255,.12);--border-strong:rgba(255,255,255,.2);--text:#f9fafb;--text-2:#cfd3d6;--text-3:#adb2b8;--primary:#f9fafb;--primary-hover:#ebeef2;--on-primary:#151517;--danger:#f25a5a;--danger-bg:rgb(242 90 90/12%);--focus:rgba(249,250,251,.16);--hover:rgba(255,255,255,.08)'

// Light and dark values mirror the product theme's design-platform tokens.
const STYLE = `:root{--dsw-alias-label-primary-inverted:#fff;--bg:#fff;--layer:#f9fafb;--border:rgba(0,0,0,.1);--border-strong:rgba(0,0,0,.18);--text:#0f1115;--text-2:#61666b;--text-3:#81858c;--primary:#0f1115;--primary-hover:#43454a;--on-primary:#fff;--danger:#ef4444;--danger-bg:rgb(239 68 68/8%);--focus:rgba(15,17,21,.12);--hover:rgba(38,49,72,.06)}
@media (prefers-color-scheme:dark){:root{${DARK_TOKENS}}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:max(32px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}
.panel{width:100%;max-width:360px}
.wordmark{display:block;height:24px;width:auto;color:var(--text);margin:0 0 40px}
h1{font-size:22px;line-height:30px;font-weight:600;margin:0 0 6px;letter-spacing:.01em}
.lead{color:var(--text-2);margin:0 0 24px}
label{display:block;font-size:13px;font-weight:500;color:var(--text-2);margin:0 0 8px}
.field{position:relative}
input{width:100%;height:46px;padding:0 46px 0 14px;font:inherit;font-size:16px;color:var(--text);background:var(--layer);border:1px solid var(--border);border-radius:12px;outline:none;transition:border-color .2s,box-shadow .2s;font-family:'SF Mono','JetBrains Mono',Consolas,Menlo,monospace;letter-spacing:.02em}
input::placeholder{color:var(--text-3);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:0}
input:focus{border-color:var(--border-strong);box-shadow:0 0 0 3px var(--focus)}
input[aria-invalid=true]{border-color:var(--danger)}
input[aria-invalid=true]:focus{box-shadow:0 0 0 3px var(--danger-bg)}
.reveal{position:absolute;top:7px;right:7px;width:32px;height:32px;display:grid;place-items:center;border:0;border-radius:8px;background:none;color:var(--text-3);cursor:pointer}
.reveal:hover{background:var(--hover);color:var(--text-2)}
.reveal[aria-pressed=true]{color:var(--text)}
.error{display:flex;gap:6px;align-items:center;margin:8px 0 0;color:var(--danger);font-size:13px}
button[type=submit]{width:100%;height:46px;margin:20px 0 0;border:0;border-radius:12px;background:var(--primary);color:var(--on-primary);font:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:background .2s}
button[type=submit]:hover{background:var(--primary-hover)}
button:focus-visible,summary:focus-visible{outline:2px solid var(--text-3);outline-offset:2px}
.remember{margin:14px 0 0;color:var(--text-3);font-size:12px;text-align:center}
details{margin:28px 0 0;padding:14px 0 0;border-top:1px solid var(--border);color:var(--text-2);font-size:13px}
summary{cursor:pointer;color:var(--text-2);list-style:none;display:flex;align-items:center;gap:6px}
summary::-webkit-details-marker{display:none}
summary::before{content:'';width:6px;height:6px;border-right:1.3px solid currentColor;border-bottom:1.3px solid currentColor;transform:rotate(-45deg);transition:transform .2s;margin:0 2px}
details[open] summary::before{transform:rotate(45deg)}
details p{margin:10px 0 0;line-height:1.6}
code{font-family:'SF Mono','JetBrains Mono',Consolas,Menlo,monospace;font-size:12px;padding:1px 5px;border-radius:5px;background:var(--layer);border:1px solid var(--border)}`

// Toggles the token field between hidden and visible text, and submits by
// replacing the current history entry.
const SCRIPT = 'const i=document.getElementById(\'token\'),b=document.getElementById(\'reveal\');b.addEventListener(\'click\',()=>{const s=i.type===\'password\';i.type=s?\'text\':\'password\';b.setAttribute(\'aria-pressed\',String(s));b.setAttribute(\'aria-label\',s?b.dataset.hide:b.dataset.show);i.focus()});i.form.addEventListener(\'submit\',e=>{e.preventDefault();location.replace(\'./?token=\'+encodeURIComponent(i.value))});'

const EYE_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>'
const ALERT_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.75v3.75M8 11.1v.1" stroke-linecap="round"/></svg>'

function sha256Source(source: string): string {
  return `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`
}

/**
 * Content Security Policy of the login page: only its own inline stylesheet
 * and script run, and the form may submit only to this origin.
 */
export const LOGIN_PAGE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `style-src ${sha256Source(STYLE)}`,
  `script-src ${sha256Source(SCRIPT)}`,
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

/**
 * Choose the login page language from an `Accept-Language` header: the
 * highest-ranked language decides, Chinese for `zh*` and English otherwise.
 * @param acceptLanguage - the request's header value, if any.
 * @returns the page locale.
 */
export function loginPageLocale(acceptLanguage: string | undefined): LoginPageLocale {
  const ranked = (acceptLanguage ?? '').split(',').map((part, index) => {
    const [tag = '', ...params] = part.trim().split(';')
    const weight = params.map(param => param.trim()).find(param => param.startsWith('q='))
    return { tag: tag.trim().toLowerCase(), quality: weight === undefined ? 1 : Number(weight.slice(2)), index }
  }).filter(entry => entry.tag !== '' && Number.isFinite(entry.quality) && entry.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index)
  return ranked[0]?.tag.startsWith('zh') === true ? 'zh' : 'en'
}

/**
 * Render the login page document.
 * @param options - language, invalid-token state, and the remembered lifetime.
 * @returns a complete HTML document for a 401 response body.
 */
export function renderLoginPage(options: LoginPageOptions): string {
  const copy = COPY[options.locale]
  const invalidAttributes = options.invalid ? ' aria-invalid="true" aria-describedby="token-error"' : ''
  const error = options.invalid
    ? `<p class="error" id="token-error" role="alert">${ALERT_ICON}<span>${copy.invalid}</span></p>`
    : ''
  return `<!doctype html>
<html lang="${copy.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#151517">
<meta name="robots" content="noindex">
<title>DeepSeek Harness</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<div class="panel">
${LOGIN_WORDMARK_SVG}
<h1>${copy.title}</h1>
<p class="lead">${copy.description}</p>
<form method="get" action="./" autocomplete="on">
<label for="token">${copy.label}</label>
<div class="field">
<input id="token" name="token" type="password" required autofocus autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${copy.placeholder}"${invalidAttributes}>
<button class="reveal" id="reveal" type="button" aria-pressed="false" aria-label="${copy.show}" data-show="${copy.show}" data-hide="${copy.hide}">${EYE_ICON}</button>
</div>
${error}
<button type="submit">${copy.submit}</button>
</form>
<p class="remember">${copy.remember(options.rememberDays)}</p>
<details>
<summary>${copy.helpSummary}</summary>
<p>${copy.help}</p>
</details>
</div>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`
}
