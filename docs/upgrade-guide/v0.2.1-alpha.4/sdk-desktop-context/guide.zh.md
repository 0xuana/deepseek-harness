---
kind: upgrade-guide
description: 现有 SDK profile 包含原生桌面工具和模型上下文。
---

# SDK 桌面工具与上下文

[English](guide.md) | 中文

## 变更

现有 `sdk` profile 现在包含 `present`、`ask_user_question`、定时任务工具、文件引用说明、checkout/GUI 上下文和时间上下文。它不启动 Web server。默认仍使用标准工具调用；`DSH_TOOLS_MODE=ptc` 在同一 profile 中选择程序化工具调用。`sdk-minimal` 保持不变。

## 迁移

1. 继续选择 `sdk`。通过 `onUserQuestion`（TypeScript）或 `on_user_question`（Python）使用原生协议回答内建问题，或保留进程内的 `user-questions/request` 回答方；没有回答方时，工具报告 `NO_PROVIDER`。
2. 仅在嵌入方提供对应值时，在 `harness-dev-context` 上设置 `checkout` 和 `guiUrl`。仅在安装中包含 CLI 和 Agent 源码树时自动识别 checkout；未提供 GUI URL 时报告其不可用。工作目录和模型仍来自 SDK 初始化。
3. 需要保留之前模型可见工具/上下文组合的自定义配置，可以禁用 `present`、`tool-ask-user`、`tool-schedule`、`file-reference-local`、`deliverable-file-references`、`harness-dev-context` 和 `time-context` 配置项。升级前请检查固定的提示词和工具 schema。
