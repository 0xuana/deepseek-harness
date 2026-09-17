# Agent Note: Multi-line display-dollar math

Status: implemented

English | [中文](2026-09-17-multiline-display-dollar-math.zh.md)

## Problem

Authors and models write `$$` display math in three shapes. The settled grammar rendered two of them: `$$math$$` on one line, and an opening `$$` alone on its line closed by `$$` alone on its line. The third shape — math on the opening line, a closing `$$` at the end of the last math line — did not:

```markdown
$$f(x)=x
\text{continued}$$
```

`micromark-extension-math` treats text after an opening `$$` as fence meta and accepts a closing fence only on a line whose content is exactly `$$` (after optional whitespace). The [markdown compatibility layer](../../archived/feature/2026-07-23-web-assistant-markdown.md) claimed only the same-line shape, and the settled renderer passes `node.value` to KaTeX while ignoring `node.meta`. The block therefore never closed: it consumed the document text that followed, `value` retained the literal `$$`, KaTeX raised `Can't use function '$' in math mode`, and [katex.tsx](../../../../packages/client/ui-primitives/src/markdown/katex.tsx)'s error arm painted the TeX source plus the swallowed prose in red.

In the session that surfaced this, one chat reply lost lines 22–55 of 55 to a single error span, and six note files lost every line after such a block (up to 500 lines) to one. A second defect shared the mechanism: when a later lone `$$` did close the flow, the opening line had already been assigned to `meta`, so the renderer silently dropped the first line of the formula.

## Decision

[mathCompatibility.ts](../../../../packages/client/ui-primitives/src/markdown/mathCompatibility.ts) owns every `$$` flow fence. Its dollar construct spans multiple lines, so an opening `$$` followed by math on the same line closes at a trailing `$$` on any later content line, and the opening line's text stays in `mathFlowValue` instead of becoming fence meta. Its paragraph-interruption check returns before the line ending, as `micromark-extension-math`'s own flow does, because consuming it there marks the next line lazy for the constructs tried afterwards and made the upstream flow end empty inside a list item.

[parse.ts](../../../../packages/client/ui-primitives/src/markdown/parse.ts) registers `mathCompatibility()` after `math()`: micromark dispatches the extension registered last first, so that order is what lets the compatibility flow claim `$$` while leaving `math()` to own inline `$…$`.

## Alternatives considered

**Keep the compatibility layer at same-line `$$…$$`.** The multi-line shape is what GitHub, KaTeX's auto-render, VS Code, and Typora accept, and the form models emit for multi-case formulas; leaving it unparsed means a red error span in place of the formula plus the rest of the document.

**Repair the parsed tree afterwards.** The flow consumes the swallowed text into `mathFlowValue`, where it is indistinguishable from math source; `meta` and `value` cannot be reassembled into the intended block, and the following blocks were never parsed at all.

**Rewrite `$$` fences in the source text before parsing.** The compatibility layer is a grammar extension by design; a text pass would need to locate code spans, fences, and escapes itself, and would change author text rather than parse it.

**Reorder without the interruption check.** Registering the compatibility flow first fixes the formula but made upstream's flow end empty inside a list item, because the failed interruption check advanced the parser's lazy table before the second construct ran.

## Consequences

The three shapes now produce the same math node, so formulas stop truncating at the opening line and stop swallowing the prose after them. `$$` fence meta is no longer honored: `$$asciimath` parses as a formula whose first line is `asciimath`, which upstream's flow would have split into meta plus body. That spelling has no user in this repository, and the renderer never read `meta` anyway.

Trailing text after a closing `$$` (`$$x$$ trailing`, or a CJK quote mark closing a line of prose) still resolves through upstream inline math; the existing `markdown.client.spec.tsx` case pins that behavior. KaTeX-level failures in a formula's own source, such as `\arccot`, remain errors by design.

## Testing

`packages/client/ui-primitives/tests/markdown.client.spec.tsx` covers the six shapes (same-line, opening-line content with a content-line close, content-line close alone, paragraph interruption, list item, and column-zero fence after a list item) and fails without the change. The DOM compatibility corpus adds `math-multiline-display` with its `.settled.txt` and `.streaming.txt` fixtures, which also pin that a column-zero `$$` after a list item stays outside the list item. `apps/web/tests/math-rendering.e2e.ts` renders the multi-line shape in the browser lane.
