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

[mathCompatibility.ts](../../../../packages/client/ui-primitives/src/markdown/mathCompatibility.ts) 现在支持跨行的显示美元块。dollar 构造把开围栏同一行的文本留在 `mathFlowValue` 里而不是当作围栏 meta，并在后续任意内容行行尾的 `$$` 处闭合，于是 `$$a+b` 接 `c+d$$` 成为一个 math 节点。开围栏那一行的 `$$` 无法闭合时（`$$x$$ trailing`）它直接放弃这次尝试：继续扫描会把更靠后一个块的闭合围栏也吞掉。

它的段落打断检查只在 dollar 构造上于换行之前返回。在那里消耗换行会让段落跨行边界保持打开，document 层因此保留容器并把下一行对随后尝试的所有构造计为 lazy；这正是上游 `mathFlow`（本构造之后被尝试的构造）在列表项内以空块结束的原因。反斜杠构造既没有那个竞争的上游构造、也没有这个问题，因此保持原有的打断行为。

[parse.ts](../../../../packages/client/ui-primitives/src/markdown/parse.ts) 把 `mathCompatibility()` 注册在 `math()` 之后：micromark 先派发最后注册的扩展，上面的 dollar flow 因此优先于上游 `mathFlow`，而行内 `$…$` 仍由 `math()` 负责。

## Alternatives considered

**兼容层维持只处理同一行 `$$…$$`。** 多行写法是 GitHub、KaTeX auto-render、VS Code、Typora 都接受的形状，也是模型写多分支公式时实际采用的形状；不解析它意味着公式位置显示为红色错误块，并连带吞掉后文。

**解析后修补语法树。** 被吞掉的正文已经进入 `mathFlowValue`，与数学源码无法区分；`meta` 和 `value` 无法还原成原意的块，而且后面的块根本没有被解析。

**解析前用文本替换改写 `$$` 围栏。** 兼容层的设计就是语法扩展；文本替换需要自己定位代码 span、围栏和转义，而且改的是作者原文而不是解析它。

**同一行闭合失败后继续扫描。** 这正是单纯打开 `multiline` 会得到的行为：`$$x$$ trailing\n\n$$y$$` 会一路扫到第二个块的 `$$`，渲染成一个同时含着两行文本的 math 节点；而上游行内数学会把 `x`、正文和 `y` 分开渲染。`$$x$$ trailing` 的既有行为已经固定了这条回退，因此该构造放弃这个候选。

**把打断检查也用在反斜杠构造上。** 这个提前返回是为了保护随后被尝试的构造；`\[`/`\(` 没有第二个构造，共用它会把握 `**before\n\[literal]\nafter**` 拆成两个段落并暴露 `**` 标记。

## Consequences

三种写法现在产生同一个 math 节点，公式不再在开围栏那一行被截断，也不再吞掉其后的正文。`$$` 围栏 meta 不再生效：`$$asciimath` 会解析成首行为 `asciimath` 的公式，而上游 flow 会把它拆成 meta 加正文。这种写法在本仓库没有使用者，且渲染器本来就从不读 `meta`。

有两种形状仍会走到上游 flow，因为兼容 flow 主动放弃它们。闭合 `$$` 之后还有文本时（`$$x$$ trailing`，或用中文引号收尾的散文行）走上游行内数学，这一点由 `markdown.client.spec.tsx` 中已有用例固定，后面还有别的 `$$` 块时同样如此。未闭合的 `$$` 块仍像本次改动之前那样延伸到下一个独占行 `$$` 或文件结尾，因为上游 flow 在 EOF 处闭合。

重复的未闭合候选保持线性解析开销：兼容 flow 在开围栏那一行就放弃 `$$a$b`，而不是把每个候选都扫到 EOF——那正是本次改动的第一版变成平方级的原因（9.6 KB 这样的行约需 4 秒，现在约 18 毫秒）。公式自身源码层面的 KaTeX 失败，例如 `\arccot`，仍按设计报错。

## Testing

`packages/client/ui-primitives/tests/markdown.client.spec.tsx` 新增多行用例——开围栏行内容由内容行行尾 `$$` 闭合、由独占行 `$$` 闭合、出现在段落之后、出现在列表项内，以及列表项之后的零缩进围栏——该用例去掉改动即失败。另有三个守卫固定本次改动不得改变的行为，且都在第一版上失败：后面还有块时的尾随文本候选、单个段落内的未闭合 `\[` 候选、以及重复未闭合美元候选的有界解析开销。

DOM 兼容语料新增 `math-multiline-display` 及其 `.settled.txt`、`.streaming.txt`，同时固定了「列表项之后的零缩进 `$$` 不进入列表项内」。`apps/web/tests/math-rendering.e2e.ts` 在浏览器 lane 渲染多行写法。
