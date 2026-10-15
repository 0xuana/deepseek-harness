---
kind: upgrade-guide
description: "pi-ai 1.2.0 目录移除了部分模型 ID，并降低了 Anthropic Sonnet 4.5 的默认上下文限制。"
---

# pi-ai 模型目录

[English](guide.md) | 中文

## 变更

pi-ai 依赖从 1.1.0 升级到 1.2.0。使用其目录的路由不再包含以下模型 ID。已保存的 `modelOverrides` 若引用这些 ID，会报告目录条目缺失的诊断；新的覆盖配置会被拒绝。显式 `models` 条目仍可声明这些 ID，但会失去目录默认值。

| 提供商 | 已移除的模型 ID |
|---|---|
| `google-vertex` | `gemini-flash-latest`, `gemini-flash-lite-latest` |
| `opencode` | `fledge-alpha-free` |
| `openrouter` | `inclusionai/ling-3.0-flash-sante:free`, `qwen/qwen-plus-2025-07-28`, `qwen/qwen3-235b-a22b`, `qwen/qwen3-30b-a3b-thinking-2507`, `qwen/qwen3-8b`, `qwen/qwen3-coder-plus`, `qwen/qwen3-max`, `qwen/qwen3-max-thinking`, `qwen/qwen3-vl-235b-a22b-thinking`, `qwen/qwen3-vl-32b-instruct`, `qwen/qwen3-vl-8b-thinking`, `qwen/qwen3.6-max-preview`, `sao10k/l3.1-euryale-70b` |
| `vercel-ai-gateway` | `alibaba/qwen-3.6-max-preview`, `alibaba/qwen3-235b-a22b-thinking`, `alibaba/qwen3-coder-plus`, `alibaba/qwen3-max`, `alibaba/qwen3-max-preview`, `alibaba/qwen3-vl-235b-a22b-instruct`, `alibaba/qwen3-vl-thinking`, `anthropic/claude-3-haiku`, `anthropic/claude-opus-4` |

在 `anthropic` 提供商中，`claude-sonnet-4-5` 和 `claude-sonnet-4-5-20250929` 的默认 `contextWindow` 从 1,000,000 token 降为 200,000 token。显式配置的覆盖值仍然优先。`vercel-ai-gateway` 的 `alibaba/qwen-3-235b` 模型现在被声明为非推理模型。

## 迁移

1. 在“设置 → 模型”中，从更新后的提供商目录选择模型。确认其端点、能力和价格符合用途；已移除的 ID 没有自动替代项。
2. 更新 profile 的 `cordis.patch.yml`、preset patch 和受影响 Session 中的模型选择。移除过时的 `providers.<provider>.modelOverrides.<id>` 条目。将显式 `providers.<provider>.models` 列表中已移除的 ID 替换为受支持的模型，并检查其声明的容量和能力。参见 [pi-ai 配置参考](../../../../packages/llm/llm-pi-ai/README.zh.md)。
3. 根据端点支持的限制检查显式 Sonnet 4.5 上下文覆盖值。启动受影响的 profile，确认模型没有配置诊断，再发送一个简短提示，验证所选路由。
