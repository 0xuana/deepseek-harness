# Agent Note: Shared time vocabulary for wall-clock selectors

Status: implemented

English | [中文](2026-09-24-shared-time-vocabulary.zh.md)

## Problem

`dsh-util-time` existed for one job and one caller shape: `canonicalClientTimeZone` validated a caller-reported zone at a wire boundary and answered `undefined`, which `dsh-api-session-controller` and `dsh-subagent` mapped onto their own domain errors. Schedule had grown the other half of the same vocabulary privately inside `packages/schedule/schedule/src/domain.ts`: a strict RFC 3339 instant parser, a local-calendar parser, a four-digit-year bound and canonical formatter, a local wall-clock resolver, and a second IANA zone canonicalizer that threw `ScheduleInputError` instead of answering a result. Two consequences followed. The same three regular expressions and the same `Intl.DateTimeFormat` canonicalization existed twice, so a change to either profile had to be made twice and verified twice. And the next consumer of a wall-clock selector had no shared entry point to reach for, which is why the profile would have been copied a third time rather than imported.

## Decision

`dsh-util-time` owns the time vocabulary that boundaries accept. `packages/util/time/src/instant.ts` holds it, `src/index.ts` re-exports it and keeps `canonicalClientTimeZone` as the `string | undefined` wrapper the existing wire boundaries consume.

The library answers discriminated results and carries no failure vocabulary. `parseOffsetInstant`, `fourDigitYearEpoch`, `parseLocalCalendar`, and `canonicalizeTimeZone` answer an `accepted` arm or a `rejected` arm naming a stable reason (`not_rfc3339`, `not_a_calendar_date`, `not_a_wall_clock_time`, `invalid_numeric_offset`, `malformed`, `out_of_range`, `blank`, `padded`, `not_area_location`, `unsupported`, `not_canonical_shape`). Each caller maps a reason onto its own code and diagnostic, so the library never writes model-facing text. `formatFourDigitYearInstant` returns the canonical instant text or `undefined` outside the bound, and `resolveLocalInstant` answers epoch milliseconds or `undefined` for a wall-clock value inside a forward transition's gap.

Schedule consumes it and keeps every domain decision. `canonicalizeTimeZone`, `decodeInstant`, `parseAtInput`, and `futureInstant` remain Schedule entry points with their existing codes and diagnostics; they now call the shared parser and map its reason. Schedule still owns the durable record shapes, the fold and transition authority, the injection-resistant framing, and all recurrence arithmetic: the cron engine, the daily and weekly date walks, the latest-due search, and the schedule-specific accepted-decision bound.

The maintained `@js-temporal/polyfill` 0.5.1 becomes a runtime dependency of `dsh-util-time` as well as of `dsh-schedule`. Local resolution continues to use it, so the Host's IANA data still decides gaps and overlaps and no caller owns offset sampling. `util/time`'s README and description lose the `zero-dependency` claim the added dependency contradicts.

Observable behavior does not change. Every accepted input resolves to the same epoch, every refused input raises the same `ScheduleInputError` or `ScheduleLogError` code and the same message, and the stored `scheduledAt` profile is unchanged, so no durable record and no recorded snapshot is re-recorded. The schedule suites assert error codes and never these message strings, so `packages/schedule/schedule/tests/domain.spec.ts` gains an assertion on the three local-calendar diagnostics; without it a wording regression in the extraction passed the whole suite. `packages/util/time/tests/instant.spec.ts` covers the new entries directly, per-file 100% included.

## Alternatives considered

**Keep the shared module private to Schedule.** A Schedule-local `time` module beside `domain.ts` would shrink that file without touching a published package, its lockfile entry, its README, or its dependency set. It was rejected because the duplication this change exists to remove is the duplicate *profile*, not the duplicate line count: the zone regular expression, the canonical `Intl` step, and the instant profile would still exist twice, and the next boundary that accepts a wall-clock selector would copy a third.

**Give the library its own error type.** A `TimeInputError` carrying the reason would let callers rethrow instead of mapping, shortening each call site. It was rejected because `util/time`'s existing contract is that each boundary owns its refusal vocabulary, and Schedule's messages reach the model through the tool result `{ code, message }` and the client's message card; a shared error class would put one caller's wording into another caller's surface.

**Have the library return `undefined` instead of reasons.** That is the shape `canonicalClientTimeZone` already has, and it was the smaller change. It was rejected because Schedule must distinguish a malformed instant from a non-existent calendar date from an out-of-range clock field to keep its existing diagnostics, and `canonicalizeTimeZone` must distinguish a bad name from a locally unresolvable one; collapsing those to one falsy value would have forced Schedule to re-derive the distinction with its own regular expressions, restoring the duplication.

**Add formatting and DST arithmetic for other consumers too.** No current consumer needs model-facing formatting or offset arithmetic from this library: `dsh-time-context` owns its own formatter and zone policy text. Adding them now would give the library a public operation set with no consumer evidence, against the package rule that ties each abstraction to a current owner and need.

## Consequences

The time profile now has one home. A change to the accepted instant profile or the zone profile is made once and covered once, and a new boundary imports it instead of copying it. Schedule's `domain.ts` loses the three regular expressions, the `Intl` canonicalization, the hand-rolled calendar conversion, and the four-digit bound arithmetic.

The cost is a wider published surface and a heavier dependency graph: `dsh-util-time` gains a runtime dependency on `@js-temporal/polyfill`, so a consumer that imports only `canonicalClientTimeZone` now loads that module too. The library is also no longer a pure "validation and canonicalization only" package, which its README and package description had to state and which its Known Limitations section now records. Schedule keeps a thin mapping layer at each entry. The local-calendar and instant mappers switch over the library's closed reason unions with a `never` default, so a newly added reason fails the build there instead of silently taking a catch-all. The zone mapper cannot: the library's `not_canonical_shape` reason is unreachable, so a switch would leave a branch the schedule suites can never execute.

`dsh-time-context` keeps its own IANA regular expression and canonicalization, and stays out of this change. It rejects a non-canonical alias at the request boundary where Schedule canonicalizes one, so unifying it means deciding which of the two behaviors the browser-time-zone instruction wants; that decision belongs to the consumer, not to this extraction.
