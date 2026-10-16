---
kind: upgrade-guide
description: The existing SDK profile includes native desktop tools and model context.
---

# SDK desktop tools and context

English | [中文](guide.zh.md)

## Change

The existing `sdk` profile now includes `present`, `ask_user_question`, schedule tools, file-reference guidance, checkout/GUI context, and time context. It does not start a Web server. Standard tool calling remains the default; `DSH_TOOLS_MODE=ptc` selects programmatic tool calling in the same profile. `sdk-minimal` is unchanged.

## Migration

1. Keep selecting `sdk`. Supply an answerer for `user-questions/request` if your application exposes questions; without one, the tool reports `NO_PROVIDER`.
2. Set `checkout` and `guiUrl` on `harness-dev-context` only when your embedding provides them. The defaults report them as unavailable. Working directory and model still come from SDK initialization.
3. Custom compositions that need the previous model-visible tool/context roster can disable the `present`, `tool-ask-user`, `tool-schedule`, `file-reference-local`, `deliverable-file-references`, `harness-dev-context`, and `time-context` rows. Review any pinned prompts and tool schemas before upgrading.
