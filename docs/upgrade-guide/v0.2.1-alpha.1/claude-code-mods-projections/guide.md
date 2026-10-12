---
kind: upgrade-guide
description: "The Claude Code mods bridge requires the session projection registry at initialization."
---

# Compose session projections for Claude Code mods

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-experimental-claude-code-mods` requires `sessionProjections` to initialize. Custom compositions that omit this service no longer start the bridge. The bridge registers the turn and context-pressure projections before serving mods.

## Migration

1. Add `@deepseek-ai/dsh-session-projection` to the `cordis.yml` or profile overlay that composes the bridge, unless it is already composed.
2. Start the profile and confirm the bridge and its mod plugins load successfully.
