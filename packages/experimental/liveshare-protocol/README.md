---
description: "Liveshare gateway frame codecs and the provider-neutral identity contract shared by the owner bundle and the Relay."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-liveshare-protocol

English | [中文](README.zh.md)

## Summary

`dsh-experimental-liveshare-protocol` gives the Liveshare owner bundle and the Relay one copy of what they must agree on: the owner/worker IPC frames, the gateway frames the Relay forwards without interpreting, and the provider-neutral identity contract and the loopback mock implementation. Both packages import it, so neither depends on the other and the Relay never loads owner code. Its only DSH dependency is the stateless `dsh-brand` primitive library.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Import `./protocol` and `./identity` from this package whenever code must speak the Liveshare wire or resolve one viewer identity: the owner host and its gateway worker, the Relay server and its acceptance tests. This is a library — no profile mounts it and no `cordis.yml` row names it.

### Entry point

```ts
import { parseGatewayFrame, rawText, sendFrame } from '@deepseek-ai/dsh-experimental-liveshare-protocol/protocol'
import { identityKeyOf, normalizeIdentity } from '@deepseek-ai/dsh-experimental-liveshare-protocol/identity'
```

`parseGatewayFrame` returns one validated frame and answers `undefined` for malformed or unknown input, so a gateway this build does not understand cannot fail the connection. A caller that needs to answer the peer instead of leaving it waiting calls `unsupportedFrameRefusal`, which turns a frame this build cannot serve into the refusal to send back. `identityKeyOf` renders one actor as the `providerId:tenantId:subjectId` key every ACL comparison uses, and `normalizeIdentity` fills the documented `default` tenant for a provider that issues none.

Relay compatibility uses declared versions, capabilities, and explicit refusals, not per-release frame translation or common-subset negotiation. Independently deployed peers have no agreed historical support window, so version-specific shims would add an unbounded set of behaviors to maintain. Published optional Relay fields remain optional; capability names are added only for implemented behavior and are never renamed or reinterpreted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`tunnel-protocol.ts` defines the frames and nothing else: `sendFrame` takes any socket exposing `readyState` and `send`, so the package needs no socket dependency and both the owner gateway and the Relay pass their own `ws` instance. `identity/` holds the provider contract, the canonical ACL key codec, and the loopback `mock` provider. Neither half imports owner code, so the Relay can depend on this package without depending on the owner bundle.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Both faces re-exported for callers that want one import |
| [`src/tunnel-protocol.ts`](src/tunnel-protocol.ts) | Owner/worker IPC frames, gateway frames, and their codecs |
| [`src/identity/types.ts`](src/identity/types.ts) | Provider-neutral identity triple and `IdentityProvider` contract |
| [`src/identity/keys.ts`](src/identity/keys.ts) | Canonical ACL key codec and the tenant normalization adapters apply before storing an identity |
| [`src/identity/mock.ts`](src/identity/mock.ts) | Loopback identity provider for local runs and tests |
| — | No runtime invariant companion is published because this package holds no mutable state and no registrations; this package's own specs exercise these codecs. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental packages](../README.md) — experimental package status.
- The Liveshare owner bundle and the Relay consume these frames and ship separately.

-----

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Gateway requests require the Relay's authenticated actor outside the opaque body; frames without that actor are refused.
- The Owner Host and worker ship together. The supervisor mints a branded UUID `registrationToken` per logical add, invalidates it on removal, and replays it only for the same retained registration after process restart. Lifecycle, requests, and cancellations echo that token with the share id; per-request `TunnelRequestToken` remains independent. IPC decoders refuse missing identities, and neither token enters Relay URLs or wire frames. Same-package IPC does not negotiate versions; Relay wire frames retain numeric ids and protocol version 1. Compatibility capabilities include `file-upload`, `actor-credential`, and `direct-connection`. An actor may carry an optional owner-verifiable `credential` (the protocol validates its type only; an owner verifies it before trusting the asserted identity, and absence keeps today's Relay-asserted semantics). A share spec may carry `connection`; absence reads as `{ mode: 'relay' }`, and a Relay that still owns the data path refuses a `direct` registration.: a relay registration that declares it may carry `allowsFileUpload` on the share support and access-state frames; every other peer keeps the stored value and a frame without the field reads as uploads off.
- Owners declaring `share-access-state` receive committed, id-less ACL/mode/expiry snapshots with a durable monotonic version. The worker forwards snapshots only from its current socket; the Host clears authority on socket loss and refreshes the authenticated requests snapshot before external execution admission. An unavailable snapshot fails closed instead of borrowing persisted ACLs.
- **Historical release support is not verified** — `tests/frames/v1` records concrete frames and refusal obligations, but does not identify a published Owner release. The gateway declares `LIVESHARE_PROTOCOL_VERSION` and implemented capabilities; the Relay rejects a declared mismatch and sends optional lifecycle frames only to declared consumers. These checks preserve recorded fields and explicit refusals, not a per-release translation or an unbounded support window.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
