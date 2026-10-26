# Agent Note: A malformed charset declaration is resolved against the body

Status: implemented

English | [中文](2026-10-26-malformed-charset-declaration.zh.md)

## Problem

A `Content-Type` header can join two encoding labels in one `charset` parameter (`text/html; charset=utf-8,gbk`). The whole parameter reaches `TextDecoder` as a single label, which rejects it, so `web_fetch` failed with `WEB_UNSUPPORTED_CONTENT_TYPE` before reading a body that is valid UTF-8 and renders in a browser. The header is malformed, but its body stays readable, and refusing the page costs more than tolerating the declaration.

## Decision

`charsetCandidates` splits the declared parameter on comma and whitespace, replaces each label with its canonical `TextDecoder` name (`gb2312` and `gbk` collapse into one candidate), keeps declaration order, drops labels no encoding has, returns the UTF-8 default when the response declares none, and throws the existing `WEB_UNSUPPORTED_CONTENT_TYPE` when a declaration names no encoding at all.

`decodeBody` decodes with a single candidate as declared and does not probe. Several candidates mean the header names encodings a server cannot mean simultaneously, so the body decides: a UTF-8 candidate wins when the bytes are strictly valid UTF-8; otherwise the first candidate whose strict decode succeeds wins; when no candidate decodes the body, the fetch fails naming the candidates rather than returning replacement characters.

The UTF-8 precedence comes from how far each decode result can be trusted. A strict UTF-8 decode of GBK text fails, while `TextDecoder('gbk')` accepted four of six UTF-8 test strings, so a legacy label's success does not identify the encoding and only UTF-8 validity does. Single-byte legacy labels such as `windows-1252` accept every byte sequence, so without the precedence an `iso-8859-1,utf-8` declaration over UTF-8 text would decode as `windows-1252`.

The strict probe decodes with `fatal: true` and `stream: true`, so an incomplete final sequence cut by `maxResponseBytes` stays buffered instead of failing the probe; the chosen label's ordinary decode then replaces it. Candidates resolve before the body is read, keeping the path that cancels the stream when a declaration names no encoding.

## Verification

- [`fetch-http.spec.ts`](../../../../packages/web/web-fetch-http/tests/fetch-http.spec.ts) covers the candidate rules (`utf-8,gbk`, the `gb2312`/`gbk` alias pair, an unrecognized label beside a valid one, a declaration naming nothing, the UTF-8 default), the single-candidate path, UTF-8 over `windows-1252`, declaration-order fallback, the no-candidate failure, and a body cut inside a character.
- The same file fetches through a local HTTP server with `charset=utf-8,gbk` over UTF-8 HTML, with `charset=gbk,utf-8` over GBK bytes, and with a body neither label decodes (rejected).
- `pnpm exec vitest run packages/web/web-fetch-http/tests --coverage --coverage.include='packages/web/web-fetch-http/src/**/*.ts'` reports 100% statements, branches, functions, and lines for the package.

## Alternatives considered

**Use the text before the first comma.** The reported header decodes correctly that way, but it presumes the first label is the intended one: `gbk,utf-8` over UTF-8 text and `iso-8859-1,utf-8` over UTF-8 text would decode as the first label and produce mojibake. Rejected.

**Treat a declaration no encoding has as absent and fall back to UTF-8.** A browser reaches its `<meta charset>` prescan through that fallback, but here it would decode genuinely GBK content as UTF-8 without a signal. Rejected; a declaration naming no encoding stays a loud failure.

**Probe the candidates in declaration order.** Legacy decoders accept UTF-8 byte sequences too readily (four of six samples), so the last declared label would decide UTF-8 content whenever a legacy label precedes it. Rejected.

**Implement the `<meta charset>` prescan instead.** That is the specification's path for a transport declaration a browser cannot use, but it adds HTML scanning to the transport layer, does not help non-HTML text responses, and the reported page decodes once the declaration itself is tolerated. Deferred, and the package README keeps `<meta charset>` as an ignored declaration.

**Keep failing with a clearer error.** Readable content is the common case behind such a header; refusing it costs more than the ambiguity of a permissive decode that still requires the bytes to decode cleanly.

## Consequences

- The model now receives pages whose header joins labels when the body decodes; when no candidate decodes the body, the failure names the candidates and no replacement-character text reaches the model.
- A short body can be valid in more than one candidate encoding. The UTF-8 precedence decides then, so a short GBK body declared `gbk,utf-8` can decode as UTF-8; that ambiguity becomes negligible as the body grows.
- A single-label declaration behaves as before, including the failure for an unrecognized label and the replacement characters from a declared-but-wrong encoding.
- A declaration naming many encodings costs one strict decode per distinct encoding, bounded by `maxResponseBytes`.
- `<meta charset>` remains ignored.
