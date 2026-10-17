---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-18-headless-auto-review

[English](2026-10-18-headless-auto-review.md) | 中文

## 概述

在可选 user-source entrypoint 字段中记录实验性 Auto review 的受信任 headless 任务入口。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-18-headless-auto-review
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "79b4e8af57859669207575df2b9bc24821d6c6a6233394f7f1535f94c50a7285"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "2e608cacf794ca60b6fa29cfedc77ef5524ab71272079107fa04a262af6ea0ed"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "e9e33baf08197572f1815717fb0fa9801a6d6534250566aed7089710591cf5b9"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "18337848615a617607dac7c277a7b4bcc71a13a3e25a0f3b11f32f0853466678"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

没有 entrypoint 的已有消息仍然有效，不获得调用者权威。当前 Auto reviewer 只识别 runner 在 Auto 生效时写入的精确 headless 标记。早期 reviewer 忽略新字段并将这些消息视为事实，因此不能新增 medium 风险授权；拒绝未知字段的读取器会按失败处理。浏览器 RPC 归属、直接父级谱系与 checkpoint 约束保持不变。无需改变 Session 格式版本。

<a id="verification"></a>
## 验证

聚焦 headless 与 Auto review 套件：161 个测试通过，两个修改模块的覆盖率均为 100%。Shipped headless profile 覆盖允许、拒绝、不合法响应、provider 失败、缺失 integration 与恢复调用者归属。记录的 headless-auto-review 场景验证只写入获准目标。

<a id="dev-note"></a>
## 开发备注

无。
