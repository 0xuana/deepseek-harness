---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-20-personalized-page-status

[English](2026-10-20-personalized-page-status.md) | 中文

## 概述

为写入模型上下文的个性化页面状态新增来源标记。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-20-personalized-page-status
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "1b43047675face5df9ba7646bbbcd873907465dcedcf22ea824f9f088cea2840"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "85d754f8957fcbbfb65bcb6dded47a816c409bb431de293ff3209b11fe093ded"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "9d2c7e74894fb4dbf3af436b09d1e9ae4a631dbdf3c7ebbfb2b490b1279c94b3"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "c81b3891a886d2e40a09d04633ec88918289bb10eee9098ed19d33c1994aa4d8"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有消息和操作记录不变。未加载本插件的读取器保留新来源种类及其 JSON 元数据，并将已记录文本作为普通上下文派生。只有写入方使用 through 序号抑制已送达通知；它不授予权限，也不改变回放解释。

<a id="verification"></a>
## 验证

创建、投影、状态和卡片组件专项测试 68 项通过，修改的 Host 模块覆盖率为 100%。Web 创建录制包含忽略卡片后追问状态，Host 协议刷新和无密钥回放各通过一次。卡片只会被替换或标为未展示，不会失效；测试覆盖后来方案的替换、人工输入排队时不出卡、回放、旧卡点击、后台通知及已开始任务的重试。功能卸载后恢复的请求准备回调不再注入上下文。

<a id="dev-note"></a>
## 开发备注

无。
