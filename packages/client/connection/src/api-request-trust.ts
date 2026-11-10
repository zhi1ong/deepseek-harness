/**
 * Browser-trust fence for every /api request. Defends the two confused-deputy
 * paths a browser opens against a local HTTP API — DNS rebinding (Host names
 * the attacker's domain while the socket reaches this server) and cross-site
 * requests fired from a malicious page. The Host fence binds every request,
 * browser-looking or not: over plain HTTP a browser attaches neither Origin
 * nor Fetch-Metadata to reads (images and navigations — those headers go only
 * to trustworthy destinations), so an unmarked request may still be a rebound
 * browser read and Host is the one header rebinding cannot forge. Non-browser
 * and remote clients pass the same fence via loopback, the listener's bind IP
 * literal, or a declared `trustedHosts` authority. Binding policy belongs to
 * the webserver config; this fence never establishes identity.
 */

import { isLoopbackHostname } from './loopback-hostname.ts'
import type { ConnectionTrustRequest } from './rpc.ts'

function header(headers: ConnectionTrustRequest['headers'], name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Normalized URL of a bare authority (hostname lowercased, default port
 * stripped, IPv6 bracketed), or undefined when unparsable.
 * @param authority - `host` or `host:port` text.
 * @param scheme - special scheme to parse under; its default port is the one stripped.
 */
function parseAuthority(authority: string, scheme: 'http:' | 'https:' = 'http:'): URL | undefined {
  try {
    // http: and https: are WHATWG "special schemes": parsing yields a non-empty hostname or throws.
    return new URL(`${scheme}//${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Assert one configured `trustedHosts` entry is a bare authority (`host` or
 * `host:port`) in canonical form: it must survive WHATWG parsing unchanged
 * (case aside). Anything parsing would silently rewrite is refused as a typo
 * that must fail the load loudly instead of being ignored until requests 403
 * or quietly changing the grant: URL parts beyond the authority
 * (`harness.internal/path`, `user@harness.internal` — which would authorize
 * the embedded hostname), stripped whitespace, a dangling colon or
 * zero-padded port (which would broaden an intended exact-port grant to every
 * port), and non-canonical host spellings (`0x7f.0.0.1`, percent-encoding,
 * unbracketed IPv6; IDN hosts are declared in punycode, the form the wire
 * carries).
 * @param entry - the configured value, verbatim.
 */
export function assertTrustedAuthority(entry: string): void {
  const entryUrl = parseAuthority(entry)
  if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return
  throw new Error(`client-connection: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`. The port is judged from URL parses under both special
 * schemes (their default ports differ, so `:80` and `:443` still count as
 * explicit), never from the raw string, where WHATWG trimming would misread
 * shapes like `host:port ` as port-less.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`${entryUrl.protocol === 'http:' ? 'https:' : 'http:'}//${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/** Whether one entry wrote an explicit port, judged like {@link canonicalAuthority}. */
function hasExplicitPort(entry: string, entryUrl: URL): boolean {
  return canonicalAuthority(entry, entryUrl) !== entryUrl.hostname
}

/**
 * How the request authority matches `trustedHosts`. An entry with an explicit
 * port matches that exact authority; a port-less entry matches the hostname on
 * any port. On a plain-HTTP listener, a port-less Host whose hostname an
 * explicit-port entry names is `proxied`: a reverse proxy dropped the
 * browser-visible port. Both sides compare through WHATWG normalization.
 */
function trustedAuthorityMatch(
  hostUrl: URL,
  trustedHosts: readonly string[],
  protocol: 'http:' | 'https:',
): 'direct' | 'proxied' | undefined {
  let match: 'proxied' | undefined
  for (const entry of trustedHosts) {
    const entryUrl = parseAuthority(entry, protocol)
    if (entryUrl === undefined) continue
    if (!hasExplicitPort(entry, entryUrl)) {
      if (entryUrl.hostname === hostUrl.hostname) return 'direct'
    } else if (entryUrl.host === hostUrl.host) {
      return 'direct'
    } else if (protocol === 'http:' && hostUrl.port === '' && entryUrl.hostname === hostUrl.hostname) {
      match = 'proxied'
    }
  }
  return match
}

/**
 * Classify an authority already accepted by {@link assertTrustedAuthority}.
 * @param entry - the configured authority, verbatim.
 * @returns true unless the entry parses as a loopback hostname.
 */
export function isRemoteAuthority(entry: string): boolean {
  const url = parseAuthority(entry)
  return url === undefined || !isLoopbackHostname(url.hostname)
}

/**
 * Whether a parsed authority names the deployment's own bind address. A browser
 * dialing that literal sends it as Host, and accepting it grants nothing
 * further: the literal is no rebinding target, the Origin and cross-site checks
 * still apply, and it stays outside `trustedHosts`. Matching ignores the port,
 * like a port-less entry, and any `%zone` id (an interface selector, not
 * address text).
 */
function isBindAddressAuthority(hostUrl: URL, bindHost: string | undefined): boolean {
  if (bindHost === undefined) return false
  const zoneAt = bindHost.indexOf('%')
  const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt)
  const bindUrl = parseAuthority(address.includes(':') ? `[${address}]` : address)
  return bindUrl !== undefined && bindUrl.hostname === hostUrl.hostname
}

/**
 * Decide whether one /api request may reach the RPC bridge.
 * @param request - Node HTTP or Fetch request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @param bindHost - the listener's own bind IP literal, accepted on any port independently of `trustedHosts`.
 * @param protocol - listener protocol for default Host ports; HTTP when no Web carrier is mounted.
 * @returns true when the Host is ours (loopback, the bind address, or trusted) and any attached browser markers are same-origin.
 */
export function isTrustedApiRequest(
  request: ConnectionTrustRequest,
  trustedHosts: readonly string[],
  bindHost?: string,
  protocol: 'http:' | 'https:' = 'http:',
): boolean {
  // Host fence (DNS-rebinding defense), applied to every request: the browser
  // fills Host from the URL it believes it is talking to, so a rebound page
  // carries the attacker's domain here even though the socket lands on this
  // server. There is no marker shortcut — a browser read over plain HTTP
  // (images and navigations) arrives with neither Origin nor
  // Fetch-Metadata, indistinguishable from curl, and its response is readable
  // by the rebound page.
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host, protocol)
  if (hostUrl === undefined) return false
  const hostMatch = isLoopbackHostname(hostUrl.hostname) || isBindAddressAuthority(hostUrl, bindHost)
    ? 'direct'
    : trustedAuthorityMatch(hostUrl, trustedHosts, protocol)
  if (hostMatch === undefined) return false
  // Cross-site fence: modern browsers label the initiator relationship on
  // every fetch; an explicit cross-site marker is refused regardless of Origin.
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  // Origin fence: when a browser attaches an Origin it must be exactly this
  // authority (compared through the same normalization as the Host) or an
  // explicit-port `trustedHosts` entry. A proxied Host lacks the port, so
  // comparing with it would admit every port of the hostname. Absent
  // Origin is fine — the Host fence above already bound the request. The
  // literal "null" (sandboxed iframes, file: pages) is an opaque origin, refused.
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  return (hostMatch === 'direct' && isSameAuthorityOrigin(origin, host)) || isDeclaredOrigin(origin, trustedHosts)
}

/**
 * Compare Host under the Origin's HTTP(S) scheme so default ports normalize
 * consistently. The transport may remain HTTP behind an HTTPS proxy.
 * @param origin - verbatim Origin header value.
 * @param host - verbatim Host header value already accepted by the Host fence.
 * @returns true only when the Origin is this listener's own `http(s)` authority.
 */
function isSameAuthorityOrigin(origin: string, host: string): boolean {
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  // Only http(s) can name this listener: the opaque `null` already threw above,
  // and every other scheme (file:, ftp:) fails here rather than matching by
  // hostname alone.
  const scheme = originUrl.protocol === 'https:' ? 'https:'
    : originUrl.protocol === 'http:' ? 'http:'
      : undefined
  if (scheme === undefined) return false
  const hostUrl = parseAuthority(host, scheme)
  return hostUrl !== undefined && originUrl.host === hostUrl.host
}

/**
 * Whether the Origin is the exact authority of an explicit-port `trustedHosts`
 * entry. Port-less entries never admit an Origin: other ports of the hostname
 * receive the same cookies.
 * @param origin - verbatim Origin header value.
 * @param trustedHosts - configured deployment authorities.
 * @returns true when an explicit-port entry names the Origin's authority.
 */
function isDeclaredOrigin(origin: string, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    return entryUrl !== undefined && hasExplicitPort(entry, entryUrl) && isSameAuthorityOrigin(origin, entry)
  })
}
