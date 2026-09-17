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

[mathCompatibility.ts](../../../../packages/client/ui-primitives/src/markdown/mathCompatibility.ts) gains multi-line display-dollar blocks. Its dollar construct keeps the opening line's text in `mathFlowValue` instead of fence meta and closes at a trailing `$$` on any later content line, so `$$a+b` continued by `c+d$$` becomes one math node. It also ends the attempt when a `$$` on the opening line cannot close — `$$x$$ trailing` — because scanning on from there would consume a later block's closing fence.

Its paragraph-interruption check returns before the line ending for the dollar construct only. Consuming the line ending there keeps the paragraph open across the line boundary, so the document layer keeps the container and counts the next line lazy for every construct tried afterwards; that made upstream's `mathFlow`, the construct tried after this one, end empty inside a list item. The backslash construct shares neither that competing upstream construct nor the problem, so it keeps its previous interruption behavior.

[parse.ts](../../../../packages/client/ui-primitives/src/markdown/parse.ts) registers `mathCompatibility()` after `math()`: micromark dispatches the extension registered last first, so the dollar flow above takes precedence over upstream's `mathFlow` while `math()` still owns inline `$…$`.

## Alternatives considered

**Keep the compatibility layer at same-line `$$…$$`.** The multi-line shape is what GitHub, KaTeX's auto-render, VS Code, and Typora accept, and the form models emit for multi-case formulas; leaving it unparsed means a red error span in place of the formula plus the rest of the document.

**Repair the parsed tree afterwards.** The flow consumes the swallowed text into `mathFlowValue`, where it is indistinguishable from math source; `meta` and `value` cannot be reassembled into the intended block, and the following blocks were never parsed at all.

**Rewrite `$$` fences in the source text before parsing.** The compatibility layer is a grammar extension by design; a text pass would need to locate code spans, fences, and escapes itself, and would change author text rather than parse it.

**Continue the dollar flow after a failed same-line close.** That is what a plain `multiline` flag produces: `$$x$$ trailing\n\n$$y$$` then scans to the second block's `$$` and renders one math node holding both lines' text, where upstream inline math renders `x`, the prose, and `y` separately. Existing behavior for `$$x$$ trailing` already pinned the fallback, so the flow declines the candidate instead.

**Apply the interruption check to the backslash construct too.** The guard exists to protect the construct tried after this one; `\[`/`\(` have no second construct, and the shared guard split `**before\n\[literal]\nafter**` into two paragraphs and exposed its `**` markers.

## Consequences

The three shapes now produce the same math node, so formulas stop truncating at the opening line and stop swallowing the prose after them. `$$` fence meta is no longer honored: `$$asciimath` parses as a formula whose first line is `asciimath`, which upstream's flow would have split into meta plus body. That spelling has no user in this repository, and the renderer never read `meta` anyway.

Two shapes still reach upstream's flow, because the compatibility flow declines them. Trailing text after a closing `$$` (`$$x$$ trailing`, or a CJK quote mark closing a line of prose) resolves through upstream inline math, as the existing `markdown.client.spec.tsx` case pins — including when a later `$$` block follows. A `$$` block left open runs to the next lone `$$` or to EOF exactly as it did before this change, because the upstream flow closes at EOF.

Repeated unclosed candidates keep linear parser work: the compatibility flow declines `$$a$b` on its opening line instead of scanning each candidate to EOF, which is what made the first revision of this change quadratic (9.6 KB of such lines took ~4 s; it takes ~18 ms now). KaTeX-level failures in a formula's own source, such as `\arccot`, remain errors by design.

## Testing

`packages/client/ui-primitives/tests/markdown.client.spec.tsx` adds the multi-line case — opening-line math closed on a content line, closed by a lone fence, after a paragraph, inside a list item, and at column zero after a list item — and that case fails without the change. Three guards pin behavior this change must not alter, and each fails against the first revision: a trailing-text candidate ahead of a later block, an unclosed `\[` candidate inside one paragraph, and bounded parser work for repeated unclosed dollar candidates.

The DOM compatibility corpus adds `math-multiline-display` with its `.settled.txt` and `.streaming.txt` fixtures, which also pin that a column-zero `$$` after a list item stays outside the list item. `apps/web/tests/math-rendering.e2e.ts` renders the multi-line shape in the browser lane.
