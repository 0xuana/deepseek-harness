---
kind: upgrade-guide
description: "Liveshare 线协议升到版本 2：accessMode 词表为 open|selected，已退场的 approval 值被拒绝而不是被重新解释。"
---

# 把 Liveshare 线协议升到版本 2

[English](guide.md) | 中文

## 变更

`LIVESHARE_PROTOCOL_VERSION` 现在是 `2`。Relay 注册声明该版本，Relay 拒绝已声明的版本不匹配；本构建不提供逐版本翻译。同一发布里 access-mode 词表是 `open | selected`：仍发送已退场 `approval` 名称的注册会被当作非法值拒绝（fail-closed），而不会被重新解释为 `open` 或 `selected`。以已退场名称存储的分享保留其 ACL 与可读性；跨站 `share-access-state` 帧以收窄后的 `selected` 名称上报它，并保留读者已经持有的访问。

## 迁移

1. 同时升级 owner Host、它的 gateway worker 与 Relay。仍声明协议版本 1 的 owner worker 或 Relay 会在注册时被以声明的版本不匹配拒绝（owner worker 为 HTTP 426，分享为 Relay 的注册拒绝），因此在服务 viewer 之前先升级每个会注册或应答分享的 peer。
2. 把存储的部署自动化里的 `access_mode=approval` 替换为 `open` 或 `selected`。仍携带 `approval` 的注册会被拒绝；在 Relay 日志里查看点名该非法值的拒绝。
3. 升级后读取一个分享的 `share-access-state` 帧：`accessMode` 是 `open` 或 `selected`，词表变更前创建的分享上报 `selected`，其 allowlist 保持不变。
