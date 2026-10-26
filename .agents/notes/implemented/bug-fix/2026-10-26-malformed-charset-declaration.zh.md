# Agent Note: 畸形的 charset 声明由正文判定解码编码

Status: implemented

[English](2026-10-26-malformed-charset-declaration.md) | 中文

## Problem

`Content-Type` 标头可以在一个 `charset` 参数里拼接两个编码标签（`text/html; charset=utf-8,gbk`）。整个参数作为单个标签交给 `TextDecoder` 会被拒绝，因此 `web_fetch` 在读取正文之前就以 `WEB_UNSUPPORTED_CONTENT_TYPE` 失败，而该正文是合法 UTF-8 且浏览器可以正常渲染。标头是畸形的，但正文仍然可读，拒绝整页的代价高于容忍这个声明。

## Decision

`charsetCandidates` 按逗号与空白切分声明的参数，把每个标签替换为其 `TextDecoder` 规范名称（`gb2312` 与 `gbk` 合并为一个候选），保留声明顺序，丢弃任何编码都不认识的标签，响应未声明时返回 UTF-8 默认值，声明存在但不含任何已知编码时抛出既有的 `WEB_UNSUPPORTED_CONTENT_TYPE`。

`decodeBody` 在只有单个候选时按声明解码且不做探测。存在多个候选说明标头同时点名了服务器不可能同时表达的编码，此时由正文判定：正文字节严格合法 UTF-8 时使用 UTF-8 候选；否则使用第一个严格解码成功的候选；没有任何候选能解码正文时抓取失败并列出候选，而不是返回替换字符。

UTF-8 优先级来自两类解码结果可信度的差距。GBK 文本的严格 UTF-8 解码会失败，而 `TextDecoder('gbk')` 接受了 6 条 UTF-8 测试字符串中的 4 条，因此传统编码解码成功并不能识别编码，只有 UTF-8 的合法性可以。`windows-1252` 这类单字节传统编码接受任意字节序列，若没有该优先级，`iso-8859-1,utf-8` 声明下的 UTF-8 文本会被当作 `windows-1252` 解码。

严格探测使用 `fatal: true` 与 `stream: true` 解码，因此被 `maxResponseBytes` 截断的末尾不完整序列会留在缓冲区，而不是让探测失败；随后所选编码的常规解码会把该不完整序列替换掉。候选项在读取正文之前解析完成，保留了声明不含任何已知编码时取消流的失败路径。

## Verification

- [`fetch-http.spec.ts`](../../../../packages/web/web-fetch-http/tests/fetch-http.spec.ts) 覆盖候选规则（`utf-8,gbk`、`gb2312`/`gbk` 别名对、无法识别的标签与有效标签并存、声明不含任何已知编码、UTF-8 默认值）、单候选路径、UTF-8 优先于 `windows-1252`、按声明顺序回退、无候选可解码的失败，以及在字符内部被截断的正文。
- 同一文件通过本地 HTTP 服务抓取 `charset=utf-8,gbk` 的 UTF-8 HTML、`charset=gbk,utf-8` 的 GBK 字节，以及两个标签都无法解码的正文（被拒绝）。
- `pnpm exec vitest run packages/web/web-fetch-http/tests --coverage --coverage.include='packages/web/web-fetch-http/src/**/*.ts'` 对该包报告语句、分支、函数与行 100% 覆盖。

## Alternatives considered

**取第一个逗号之前的文本。** 这样报告的标头能正确解码，但它假定第一个标签就是服务器本意：`gbk,utf-8` 下的 UTF-8 正文与 `iso-8859-1,utf-8` 下的 UTF-8 正文都会按第一个标签解码并产生乱码。拒绝。

**把不含任何已知编码的声明当作未声明并回退 UTF-8。** 浏览器正是经由该回退走到 `<meta charset>` 预扫描，但在这里会把真正的 GBK 内容无提示地当作 UTF-8 解码。拒绝；不含任何已知编码的声明保持显式失败。

**按声明顺序探测候选。** 传统编码解码器接受 UTF-8 字节序列的比例过高（6 条样本中 4 条），只要传统标签排在前面，UTF-8 正文就会由最后一个声明标签决定。拒绝。

**改为实现 `<meta charset>` 预扫描。** 那是规范为浏览器无法使用的传输声明准备的路径，但会把 HTML 扫描加入传输层，对非 HTML 文本响应没有帮助，而所报页面在容忍声明本身之后即可正确解码。延期处理，包 README 仍把 `<meta charset>` 记为被忽略的声明。

**继续失败并给出更清晰的错误。** 这类标头背后通常是可读内容；在仍然要求正文能干净解码的前提下，容忍解码的模糊性代价更低。

## Consequences

- 当正文可解码时，模型现在能读到标头拼接了多个标签的页面；没有任何候选能解码正文时，失败信息会列出候选，且不会有替换字符文本进入模型。
- 较短的正文可能在多个候选编码下都合法，此时由 UTF-8 优先级决定，因此 `gbk,utf-8` 声明下较短的 GBK 正文仍可能被当作 UTF-8 解码；随正文变长该模糊性趋近于零。
- 单标签声明与之前一致，包括无法识别标签的失败，以及声明错误编码产生的替换字符。
- 声明点名大量编码时，每个不同编码会消耗一次严格解码，受 `maxResponseBytes` 限制。
- `<meta charset>` 仍然被忽略。
