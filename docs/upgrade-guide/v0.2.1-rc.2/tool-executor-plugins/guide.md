---
kind: upgrade-guide
description: "Tool execution modes move from dsh-tools configuration into explicit executor plugins."
---

# Mount a tool executor

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-tools` keeps tool registration and executor selection, but rejects the removed `mode` and `maxParallelSubCalls` configuration fields at load time. Native and PTC execution require `@deepseek-ai/dsh-tool-executor-native` or `@deepseek-ai/dsh-tool-executor-ptc`. Shipped profiles mount an executor; custom compositions must add one. The existing `dsh-agent-tool-presentation` selector remains supported but is deprecated. Enabled `tool-executor-native` and `tool-executor-ptc` rows are required at startup; invalid executor configuration now stops startup.

## Migration

1. Keep the `dsh-tools` row and remove its execution configuration. Mount one native or PTC executor in the intended deployment or preset scope. For shipped profile patches, target the executor row instead of the `tools` row.
2. Move `maxParallelSubCalls` to the PTC executor configuration. PTC still requires a compatible runtime. `agent-loop.maxParallelToolCalls` and saved overrides stay in place with default `10`. The loop forwards the current limit to each batch; live edits apply to the next batch instead of the next tool group.
3. Custom executors implement `describe` and `execute`. Programmatic callers pass raw `calls` and `signal`, optional `agent`, and optional `log: { turn, step }`; read single-call outcomes from `results`. Omit `log` outside a committed model step.
4. Import PTC SDK renderers and `CodeRunFailedError` from `@deepseek-ai/dsh-tool-executor-ptc`. Run a task with the selected interaction mode and confirm its tool results appear in the Session.
5. Import `ToolExecutionPipeline` and `executeToolBatch` from `@deepseek-ai/dsh-tools/pipeline`. Complete calls, including single calls, use batches; custom schedulers call `prepare`, `dispatch`, and `complete` directly. Add `@deepseek-ai/dsh-tool-testkit` as a development dependency for tool fixtures and import them from that package. Neither is exported by the tool registry entry.
6. Import `PtcDispatchLog` from the PTC executor package using `import type`. Detached Session readers use `@deepseek-ai/dsh-tool-executor-ptc/types` for durable dispatch events. Live PTC policy and message-source declarations remain on the executor package entry.
