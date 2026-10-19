---
kind: upgrade-guide
description: "Session 投影注册返回可调用的 thenable，取代原生 Promise。"
---

# Session 投影注册返回可调用的 thenable

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-session-projection` 保持声明的 `register(definition): Promise<ProjectionHandle<S>>` API，但运行时返回值从原生 Promise 变为可调用的 thenable。`await`、`.then()`、`.catch()` 和 `.finally()` 仍交付相同的保留句柄。`typeof registration` 现在为 `"function"`，`registration instanceof Promise` 为 false。按这些检查分支或把函数视为回调的代码会受影响；Vitest 的 `.rejects` 可能调用 disposer，而不是观察注册错误。

可调用值支持已编译插件中已弃用的同步 disposer 用法。registry 级 `stateOf(session, key): unknown` 也恢复为已弃用的运行时 API；新代码通过保留句柄读取。异步 return/yield 会将其吸收为句柄，而句柄不是有效的 Cordis effect。警告时机和忽略错误的处理方式见[运行时兼容说明](../../../../packages/session/session-projection/README.zh.md#deprecated-plugin-compatibility)。

## 迁移

1. 继续等待 `ctx.sessionProjections.register(definition)`，并使用返回句柄的 `stateOf(session)` 和 `dispose()` 方法。在异步插件或 effect 中等待注册并返回 `void`；所属 fiber 会自动释放注册。
2. 需要原生 Promise 时传入 `Promise.resolve(registration)`。将对注册值的 `typeof` 或 `instanceof Promise` 检查改为正常等待。在 Vitest 中使用 `await expect(Promise.resolve(registration)).rejects.toThrow(...)`。
3. 运行插件初始化和释放测试，包括注册拒绝用例。确认能观察到预期注册错误，且已释放的注册不再参与快照。
