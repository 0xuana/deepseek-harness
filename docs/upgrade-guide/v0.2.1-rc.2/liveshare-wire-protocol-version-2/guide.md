---
kind: upgrade-guide
description: "The Liveshare wire protocol moves to version 2: the accessMode vocabulary is open|selected and the withdrawn approval value is refused, not reinterpreted."
---

# Move the Liveshare wire protocol to version 2

English | [中文](guide.zh.md)

## Change

`LIVESHARE_PROTOCOL_VERSION` is now `2`. Relay registration states that version and the Relay refuses a declared mismatch; there is no version translation. In the same release the access-mode vocabulary is `open | selected`: a registration still sending the retired `approval` name is refused as an invalid value (fail-closed) instead of being reinterpreted as `open` or `selected`. A share stored under the retired name keeps its ACL and is readable; the cross-site `share-access-state` frame reports it with the narrowed `selected` name and leaves readers the access they already hold.

The protocol version stays `2`: a new optional `allowsFileUpload` share/access-state field and the `file-upload` capability are additive, and a frame without the field reads as uploads off.

## Migration

1. Upgrade the owner Host, its gateway worker, and the Relay together. An owner worker or a Relay still declaring protocol version 1 is refused at registration with the declared mismatch (HTTP 426 for the owner workers, the Relay's registration refusal for shares), so upgrade every peer that registers or answers a share before serving viewers.
2. Replace `access_mode=approval` in stored deployment automation with `open` or `selected`. A registration still carrying `approval` is refused; inspect the Relay log for the refusal naming the invalid value.
3. Read one share's `share-access-state` frame after the upgrade: `accessMode` is `open` or `selected`, and a share created before the vocabulary change reports `selected` with its unchanged allowlist.
