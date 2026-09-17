# Agent Note: Multi-line display-dollar math

Status: implemented

[English](2026-09-17-multiline-display-dollar-math.md) | 中文

## Problem

作者和模型写 `$$` 行间公式时有三种写法。定稿语法只渲染其中两种：一行内开闭的 `$$math$$`，以及 `$$` 独占一行、由独占一行的 `$$` 闭合。第三种——开围栏同一行就带公式内容，闭合 `$$` 落在最后一行公式行行尾——不渲染：

```markdown
$$f(x)=x
\text{continued}$$
```

`micromark-extension-math` 把开围栏 `$$` 之后的同一行文本当作围栏 meta，并且只接受内容恰为 `$$`（后接可选空白）的行作为闭合围栏。[markdown 兼容层](../../archived/feature/2026-07-23-web-assistant-markdown.md)只认同一行开闭这一种形状，而定稿渲染器把 `node.value` 交给 KaTeX，不读 `node.meta`。于是该块始终不闭合：它吞掉后续正文，`value` 里残留字面 `$$`，KaTeX 抛出 `Can't use function '$' in math mode`，[katex.tsx](../../../../packages/client/ui-primitives/src/markdown/katex.tsx) 的错误分支把 TeX 原文连同被吞掉的正文一起显示为红色。

在暴露该问题的会话中，一条聊天回复 55 行里有 34 行（第 22–55 行）变成同一个错误块，六个笔记文件从出错点起的所有行（最多约 500 行）同样变成一个错误块。同一机制还带出第二个缺陷：当更靠后的独占行 `$$` 恰好闭合了这个流时，开围栏那一行已经归给 `meta`，渲染器于是静默丢掉公式的第一行。

## Decision

[mathCompatibility.ts](../../../../packages/client/ui-primitives/src/markdown/mathCompatibility.ts) 拥有所有 `$$` flow 围栏。它的 dollar 构造跨多行：开围栏 `$$` 后同一行的公式内容可以延续到后续内容行，由行尾的 `$$` 闭合；开围栏那一行的文本留在 `mathFlowValue` 里，不再变成围栏 meta。它的段落打断检查在换行符之前返回，与 `micromark-extension-math` 自己的 flow 一致；因为在那里消耗换行会把下一行对随后尝试的构造标记为 lazy，使上游 flow 在列表项内以空块结束。

[parse.ts](../../../../packages/client/ui-primitives/src/markdown/parse.ts) 把 `mathCompatibility()` 注册在 `math()` 之后：micromark 先派发最后注册的扩展，这个顺序让兼容 flow 认领 `$$`，同时把行内 `$…$` 留给 `math()`。

## Alternatives considered

**兼容层维持只处理同一行 `$$…$$`。** 多行写法是 GitHub、KaTeX auto-render、VS Code、Typora 都接受的形状，也是模型写多分支公式时实际采用的形状；不解析它意味着公式位置显示为红色错误块，并连带吞掉后文。

**解析后修补语法树。** 被吞掉的正文已经进入 `mathFlowValue`，与数学源码无法区分；`meta` 和 `value` 无法还原成原意的块，而且后面的块根本没有被解析。

**解析前用文本替换改写 `$$` 围栏。** 兼容层的设计就是语法扩展；文本替换需要自己定位代码 span、围栏和转义，而且改的是作者原文而不是解析它。

**只调整注册顺序、不加打断检查。** 让兼容 flow 优先能修好公式，但会让上游 flow 在列表项内以空块结束——失败的打字检查在被第二个构造尝试之前就把解析器的 lazy 表推进了。

## Consequences

三种写法现在产生同一个 math 节点，公式不再在开围栏那一行被截断，也不再吞掉其后的正文。`$$` 围栏 meta 不再生效：`$$asciimath` 会解析成首行为 `asciimath` 的公式，而上游 flow 会把它拆成 meta 加正文。这种写法在本仓库没有使用者，且渲染器本来就从不读 `meta`。

闭合 `$$` 之后还有文本的情况（`$$x$$ trailing`，或用中文引号收尾的散文行）仍走上游行内数学；`markdown.client.spec.tsx` 中已有的用例固定了该行为。公式自身源码层面的 KaTeX 失败，例如 `\arccot`，仍按设计报错。

## Testing

`packages/client/ui-primitives/tests/markdown.client.spec.tsx` 覆盖六种形状（同一行开闭、开围栏行内容加内容行闭合、闭合围栏独占一行、打断段落、列表项内、列表项之后的零缩进围栏），去掉改动即失败。DOM 兼容语料新增 `math-multiline-display` 及其 `.settled.txt`、`.streaming.txt`，同时固定了「列表项之后的零缩进 `$$` 不进入列表项内」。`apps/web/tests/math-rendering.e2e.ts` 在浏览器 lane 渲染多行写法。
