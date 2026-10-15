---
kind: upgrade-guide
description: "The pi-ai 1.2.0 catalog removes model IDs and lowers the default context limit for Anthropic Sonnet 4.5."
---

# pi-ai model catalog

English | [中文](guide.zh.md)

## Change

The pi-ai dependency changes from 1.1.0 to 1.2.0. Routes that use its catalog lose the following model IDs. Stored `modelOverrides` for these IDs report a missing-catalog diagnostic; new overrides are rejected. An explicit `models` entry can still declare an ID, but it loses its catalog defaults.

| Provider | Removed model IDs |
|---|---|
| `google-vertex` | `gemini-flash-latest`, `gemini-flash-lite-latest` |
| `opencode` | `fledge-alpha-free` |
| `openrouter` | `inclusionai/ling-3.0-flash-sante:free`, `qwen/qwen-plus-2025-07-28`, `qwen/qwen3-235b-a22b`, `qwen/qwen3-30b-a3b-thinking-2507`, `qwen/qwen3-8b`, `qwen/qwen3-coder-plus`, `qwen/qwen3-max`, `qwen/qwen3-max-thinking`, `qwen/qwen3-vl-235b-a22b-thinking`, `qwen/qwen3-vl-32b-instruct`, `qwen/qwen3-vl-8b-thinking`, `qwen/qwen3.6-max-preview`, `sao10k/l3.1-euryale-70b` |
| `vercel-ai-gateway` | `alibaba/qwen-3.6-max-preview`, `alibaba/qwen3-235b-a22b-thinking`, `alibaba/qwen3-coder-plus`, `alibaba/qwen3-max`, `alibaba/qwen3-max-preview`, `alibaba/qwen3-vl-235b-a22b-instruct`, `alibaba/qwen3-vl-thinking`, `anthropic/claude-3-haiku`, `anthropic/claude-opus-4` |

For the `anthropic` provider, `claude-sonnet-4-5` and `claude-sonnet-4-5-20250929` have a default `contextWindow` of 200,000 tokens, down from 1,000,000. Explicit configuration overrides still take precedence. The `vercel-ai-gateway` model `alibaba/qwen-3-235b` is now declared non-reasoning.

## Migration

1. In Settings → Models, select a model from the updated provider catalog. Check that its endpoint, capabilities, and price fit your use; removed IDs have no automatic replacement.
2. Update model selections in your profile's `cordis.patch.yml`, preset patches, and affected Sessions. Remove obsolete `providers.<provider>.modelOverrides.<id>` entries. Replace removed IDs in explicit `providers.<provider>.models` lists with supported models and review their declared capacities and capabilities. See the [pi-ai configuration reference](../../../../packages/llm/llm-pi-ai/README.md).
3. Review explicit Sonnet 4.5 context overrides against the endpoint's supported limit. Start the affected profile, confirm its model has no configuration diagnostic, and send a short prompt to verify the selected route.
