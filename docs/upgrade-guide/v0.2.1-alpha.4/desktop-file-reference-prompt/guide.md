---
kind: upgrade-guide
description: File-reference guidance moves from the Web UI plugin to a shared prompt row.
---

# Desktop file-reference prompt composition

English | [中文](guide.zh.md)

## Change

The Web bundle now mounts `@deepseek-ai/dsh-tool-present/prompt` as `deliverable-file-references`. Previously `@deepseek-ai/dsh-client-ui-deliverables` registered that guidance. Default Web behavior is unchanged; custom compositions and patches that disable the UI row need to address the prompt separately.

## Migration

1. In a custom composition that mounts `dsh-client-ui-deliverables` directly, add a row named `@deepseek-ai/dsh-tool-present/prompt` to retain the guidance.
2. To suppress both file cards and guidance in a Web profile, disable both `ui-deliverables` and `deliverable-file-references`.
3. Inspect the assembled system prompt and confirm that `ui:deliverable-file-references` is present or absent as intended.
