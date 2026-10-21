---
kind: upgrade-guide
description: "CUA relative coordinates accept integers from 0 to 999 and normalize by 999."
---

# CUA relative coordinates use 0–999

English | [中文](guide.zh.md)

## Change

The `cua` tool and application/window object methods now accept integers from 0 to 999 when `relative: true`. The previous range was 0 to 1000. Coordinates are divided by 999 instead of 1000 before scaling to window dimensions; the upper endpoint stays inside the window. This affects `click`, `hover`, `scroll`, and both `drag` endpoints. Absolute screenshot pixels and AX element indices are unchanged.

## Migration

1. Update scripts and prompts that generate relative coordinates. For a normalized fraction `r` between 0 and 1, use `Math.round(r * 999)`. Convert stored coordinates on the old scale with `Math.round(oldValue * 999 / 1000)`; an old endpoint of 1000 becomes 999.
2. Read fresh window state, then invoke the affected action with integer coordinates in 0–999. Verify the result with a fresh observation. Relative values of 1000, negative values, and fractions are rejected before native input.
