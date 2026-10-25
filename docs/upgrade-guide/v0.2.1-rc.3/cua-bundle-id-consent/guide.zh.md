---
kind: upgrade-guide
description: macOS Computer Use 授权改用 Bundle ID，旧应用身份需要重新授权。
---

# macOS Computer Use 应用身份

[English](guide.md) | 中文

## 变更

应用授权使用原生应用提供的、区分大小写的 Bundle ID。不同路径的版本和副本共用许可与撤销决定，不受签名状态影响。缺少 Bundle ID 的应用仍仅能获得进程实例级会话许可。profile 存储和对话范围保持不变。

现有路径和签名授权不匹配新身份。旧记录仍可查看和撤销，但不会自动授权其他安装副本。其他程序声明已批准的 Bundle ID 时也会继承许可，这项规则不验证发布者身份。

## 迁移

1. 升级后重新选择各应用并确认权限。“始终允许”覆盖当前 profile 中具有相同 Bundle ID 的所有版本和副本。
2. 在 Computer Use 应用管理中移除旧身份规则留下的过时授权。选择具有相同 Bundle ID 的另一个已安装副本，确认在许可范围内不再询问授权。
3. 需要停止所有副本的访问时，撤销共用许可。使用不同 Bundle ID 的版本仍需分别批准。
