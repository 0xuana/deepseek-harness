/**
 * URL validation, content-type classification, and charset resolution for the
 * local HTTP(S) fetch provider — the pure, network-free half. The provider's
 * `fetch()` composes these with transport (redirect following, byte caps,
 * decoding).
 *
 * @module @deepseek-ai/dsh-web-fetch-http/policy
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** Maximum accepted request URL length enforced by the fetch provider. */
export const WEB_FETCH_MAX_URL_LENGTH = 2048

/** The body kinds this provider decodes. */
export type FetchableKind = 'html' | 'text'

/**
 * Parse a request URL and enforce network-independent transport restrictions:
 * HTTP(S) only and no embedded credentials. The provider applies this before
 * resolving a destination.
 *
 * @param input - the raw URL string from the fetch request.
 * @returns the parsed `URL`.
 */
export function parseFetchUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Validate a request URL against the provider's complete pre-network policy:
 * bounded length plus the restrictions enforced by {@link parseFetchUrl}.
 * Public-address resolution and connection pinning run after this check.
 *
 * @param input - the raw URL string from the fetch request.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string): URL {
  if (input.length > WEB_FETCH_MAX_URL_LENGTH) {
    throw new WebError(`URL exceeds the maximum length of ${WEB_FETCH_MAX_URL_LENGTH}`, 'WEB_INVALID_URL')
  }
  return parseFetchUrl(input)
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call.
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*` plus a few structured text types are `text`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the decodable kind, or `undefined` for an unsupported type.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Extract the `charset` parameter from a response `Content-Type`, lower-cased,
 * or `undefined` when absent. {@link charsetCandidates} resolves the declared
 * label into decoders; keeping the parameter unprocessed lets a malformed
 * declaration be reported exactly as the server sent it.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the lower-cased charset parameter, or `undefined` when none is
 *   declared.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/** Canonical `TextDecoder` name of UTF-8, and the default when no charset is declared. */
const UTF8_ENCODING = 'utf-8'

/**
 * Resolve a declared charset parameter into the encoding labels that can decode
 * the body, in declaration order. An absent parameter yields the UTF-8 default.
 * A parameter is split on the comma and whitespace separators that a malformed
 * header uses to join several labels (`charset=utf-8,gbk`); each label is
 * replaced by its canonical `TextDecoder` name, so `gb2312` and `gbk` collapse
 * into one candidate, and labels no encoding has are dropped. Throws
 * {@link WebError} `WEB_UNSUPPORTED_CONTENT_TYPE` when a declaration is present
 * but names no recognizable encoding.
 *
 * @param charset - the declared charset parameter (from {@link parseCharset}),
 *   or `undefined` when the response declares none.
 * @returns the candidate encoding labels; never empty.
 */
export function charsetCandidates(charset: string | undefined): string[] {
  if (charset === undefined) return [UTF8_ENCODING]
  const candidates: string[] = []
  for (const label of charset.split(/[\s,]+/)) {
    if (label.length === 0) continue
    const encoding = canonicalEncoding(label)
    if (encoding !== undefined && !candidates.includes(encoding)) candidates.push(encoding)
  }
  if (candidates.length === 0) {
    throw new WebError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE')
  }
  return candidates
}

/**
 * Decode a response body with its candidate encodings. One candidate is used as
 * declared. Several candidates mean the header joined labels a server cannot
 * mean simultaneously, so the bytes decide: a UTF-8 candidate wins when the body
 * is valid UTF-8 (a strict decode of legacy multi-byte text as UTF-8 fails,
 * while those legacy decoders accept UTF-8 sequences too readily to count as
 * evidence), otherwise the first candidate whose strict decode succeeds. When
 * no candidate decodes the body the fetch fails rather than returning
 * replacement characters.
 *
 * @param bytes - the complete response body, possibly cut at the byte cap.
 * @param candidates - the encoding labels from {@link charsetCandidates}.
 * @returns the decoded text.
 */
export function decodeBody(bytes: Uint8Array, candidates: readonly string[]): string {
  const declared = candidates.length === 1 ? candidates[0] : undefined
  if (declared !== undefined) return new TextDecoder(declared).decode(bytes)
  const chosen = chooseEncoding(bytes, candidates)
  return new TextDecoder(chosen).decode(bytes)
}

/** Canonical `TextDecoder` name of a label, or `undefined` when no encoding has it. */
function canonicalEncoding(label: string): string | undefined {
  try {
    return new TextDecoder(label).encoding
  } catch {
    // A RangeError here means this label names no encoding; a malformed
    // declaration may still name a usable encoding beside it.
    return undefined
  }
}

/** Whether an encoding decodes the body, tolerating a final sequence cut at the byte cap. */
function decodesStrictly(encoding: string, bytes: Uint8Array): boolean {
  try {
    new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: true })
    return true
  } catch {
    // A RangeError here means the body holds a sequence this encoding cannot
    // decode, so the next candidate gets the bytes.
    return false
  }
}

/** Pick the candidate encoding for a multi-label declaration, or throw when none decodes the body. */
function chooseEncoding(bytes: Uint8Array, candidates: readonly string[]): string {
  if (candidates.includes(UTF8_ENCODING) && decodesStrictly(UTF8_ENCODING, bytes)) return UTF8_ENCODING
  for (const encoding of candidates) {
    if (decodesStrictly(encoding, bytes)) return encoding
  }
  throw new WebError(
    `cannot decode the response body with any declared charset (${candidates.join(', ')})`,
    'WEB_UNSUPPORTED_CONTENT_TYPE',
  )
}
