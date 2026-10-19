# Agent Note: Client 插件包资源经 Host 路由按 URL 加载

Status: proposed

[English](2026-10-19-client-plugin-package-assets.md) | 中文

## Problem

动态 Client 插件的浏览器半侧由 [client 打包预设](../../../../packages/client/tsdown.client.ts) 打成 lazy-CJS factory，经 [Client 模块系统](../../../../packages/client/modules/README.zh.md) 的 `/plugins` 路由加载。这条路由只提供 `client.js` 和包内 chunk，没有读取包内其他文件的路径，所以插件代码引用的图片只能由预设转成 base64 data URL 打进 bundle；样式里用到的图片则由包级构建配置替换成内联样式。

代价：

- ui-settings-account 的引导插图让 `client.js` 达到 3.4 MB，其中图片原始字节 2.4 MB，转成 base64 还要再大三分之一。不管插图显不显示，这些字节都随 JS 一起下载和解析。
- ui-plugin-manager 的功能预览（约 305 KB SVG）同样打进 bundle。[功能预览 Note](../../implemented/feature/2026-10-14-built-in-plugin-feature-previews.zh.md) 当时没有把图片放进各 bundle 包，理由之一就是缺少 Host 读取路径。
- ui-chat 为一张鲸鱼图在 [包级 tsdown 配置](../../../../packages/client/ui-chat/tsdown.config.ts) 里自写了替换插件；每个要在样式里用图片的包都得重复这类构建代码。

## Proposal

插件包把原始资源放在 `src/client/assets/`。预设把被引用的资源产出到 `lib/assets/`，并把 JS import 和插件 CSS 中的 `url()` 都编译成指向 Host 路由的 URL；包通过 exports `./assets/*` 发布这些产物；[`ClientModuleRegistry`](../../../../packages/client/modules/src/index.ts) 在现有 `/plugins` 前缀下提供 `/plugins/<包名>/assets/<路径>`。

本期范围是我们自己的 Client 代码（Cordis 插件、slot 组件、service）及其样式表引用的图片。以下不在本期：

- 三方库自己加载的资源，如 PDF.js 的字体、cmap、wasm 和 worker，以及依赖包样式表里的 `url()`；
- 插件元数据图标：[package-meta](../../../../packages/boot/app-boot/src/package-meta.ts) 仍返回 data URL；
- static-linked 包：由 Vite 壳处理资源。

### 开发者写法

| 位置 | 内容 |
|---|---|
| `src/client/assets/**` | 原始资源 |
| `lib/assets/**` | 预设产出，只含本次构建被引用的资源 |
| `package.json` `exports` | `"./assets/*": "./lib/assets/*"` |
| `package.json` `files` | `lib/assets` |

```tsx
// src/client/OnboardingWelcomeStep.tsx
import welcome from './assets/onboarding/welcome.webp'

<img src={welcome} alt="" />
```

```css
/* src/client/chat/ChatView.module.css */
.whale { mask: url('../assets/running-whale@2x.png') center / 100% 100% no-repeat; }
```

构建产物里只有 URL：

```js
var welcome_default = "plugins/@deepseek-ai/dsh-client-ui-settings-account/assets/onboarding/welcome-3f9a0c1d2e4b.webp";
```

```css
.x1y2_whale{mask:url("plugins/@deepseek-ai/dsh-client-ui-chat/assets/running-whale%402x-8c41d07e5a9f.png") 50%/100% 100% no-repeat}
```

URL 在构建时就已确定：JS 侧是一个模块常量，CSS 侧是改写后的样式文本。组件不需要新的 hook、inject 或 service。

### 扩展名与类型声明

| 扩展名 | `content-type` |
|---|---|
| `.svg` | `image/svg+xml` |
| `.png` | `image/png` |
| `.webp` | `image/webp` |
| `.jpg`、`.jpeg` | `image/jpeg` |

这和插件元数据图标接受的格式相同。扩展名表在代码中只定义一处，放在 Client 模块系统里，预设和 Host 共用。

类型声明放在 Client 编译共享的类型根 `scripts/types/client-assets/`，登记到 [`tsconfig.base.client.json`](../../../../tsconfig.base.client.json) 的 `types`，与现有的 `client-build-environment` 同一机制。每个扩展名声明为 `export default string`，各包自带的 `assets.d.ts` 删除。测试断言声明的扩展名与扩展名表一致。表外扩展名的 import 没有类型声明，构建也会失败。

### 构建

`dsh-image-inline` 换成 `dsh-package-asset`，只作用于动态 bundle 的浏览器 face：

1. 按 importer 的源码位置解析相对路径。构建读取的是 `lib/types/`，沿用现有的 `lib/types` → `src` 换算。
2. 文件的真实路径必须在本包的 `src/client/assets/` 内，否则构建失败；引用他包或 npm 依赖里的图片同样失败。
3. `package.json` 的 `exports["./assets/*"]` 必须恰好是 `./lib/assets/*`，否则构建失败。
4. rev 取文件字节 sha1 的前 12 位 hex，与现有 rev 同长度。
5. 按产出规则决定它在 `lib/assets/` 下的文件名：相对 `src/client/assets/` 的路径，在扩展名前插入 `-<rev>`（`icons/whale@2x.png` → `icons/whale@2x-<rev>.png`），作为构建产物 emit；同一文件只 emit 一次。
6. 模块代码为 `export default "plugins/<包名>/assets/<产出路径>"`，路径逐段 `encodeURIComponent`（例如 `@` 写成 `%40`），不带查询串；包名原样输出。

产出规则集中在预设里。以后增加命名后缀、格式转换或压缩时只改预设，import 方拿到的始终是产出文件的 URL。浏览器 face 是 `lib/assets/` 的唯一写入方，每次构建后删除本次没有产出的文件，所以发布内容与实际引用一致。实验包隔离检查照常覆盖这些产物。

插件 CSS 的三条管线（module、global、`?inline`）在 lightningcss 编译时访问每个 `url()`：

- 样式表真实路径在本包 `src/` 内时，相对路径 `url()` 按样式表所在目录解析，再走上面的步骤 2–5，改写为 `url("plugins/<包名>/assets/<产出路径>")`；解析不到 `src/client/assets/` 内的表内文件就构建失败。
- `data:`、`#片段`、带协议的 URL、以 `/` 开头的路径和空 `url('')` 原样保留。
- 依赖包的样式表不改写，例如 FortuneSheet 的 `url("EwaAntH.gif")`。

插件样式经 `<style>` 注入页面文档，所以改写后的相对 URL 与 JS 侧一样按文档 base 解析。`?inline` 文本由插件自己插入；插入到页面以外的文档时，文档相对 URL 不成立，由该插件负责。

dualClient 的 Node Client face 里出现资源 import 时构建失败。ui-chat 的包级替换插件删除。

### Host 路由

请求形式为 `/plugins/<包名>/assets/<产出路径>`，与包内 chunk 共用 `/plugins` 前缀；`fetchBundle()` 返回相同的响应。`bundleResource` 先按路径规则 `/plugins/<包名>/assets/` 分流，命中就只由资源分支回答；查询串不参与选择内容。

| 顺序 | 检查 | 不通过 |
|---|---|---|
| 1 | 方法是 GET 或 HEAD | 405 |
| 2 | `<包名>` 是当前启用的 client 行 | 404 |
| 3 | 路径解码一次后，从该包自己的 package.json 出发，用 Node 的 `require.resolve` 解析 `<包名>/assets/<路径>`；包的 exports 决定哪些文件存在，`.`、`..` 段、未导出、文件不存在和目录都由 Node 拒绝 | 404 |
| 4 | 解析出的文件扩展名在表内（以解析结果为准：Node 会把路径里的 `#`、`?` 当 URL 语法截断） | 404 |
| 5 | `If-None-Match` 等于 ETag | 304，无 body，不打开文件 |

解析时出现任何异常都返回 404。

200 响应从磁盘流式发送文件，带以下响应头：

- `content-type`：按扩展名表；
- `cache-control: public, max-age=31536000, immutable`：与 bundle 相同；
- `etag: "<请求里的产出路径>"`：产出路径本身带内容 rev，路径相同即内容相同；
- `x-content-type-options: nosniff`；
- SVG 额外加 `content-security-policy: script-src 'none'`，直接打开 SVG 时不执行脚本。

Host 不计算 hash，也不缓存文件内容：每次请求从磁盘流式读一遍。

### 解析与范围

解析交给 Node 的 `require.resolve`，以包自己的 package.json 为起点（包自引用），不另写路径规则，也不需要 Loader 树的解析基准。包的 package.json 路径在扫描启用行时就已拿到。

HTTP 只为启用的 client 包、只为其 `./assets/*` 导出提供文件。HTTP 请求无法表明来自哪个插件；“只能用本包资源”由构建步骤 2 保证。以后插件元数据要提供未启用包的图片时，由 plugin manager 先定位到包的 package.json，再用同样的 `require.resolve` 解析。

### 缓存与 HMR

- rev 写在产出文件名里：内容一变文件名就变，同一个 URL 永远对应同一份内容。
- 资源没有独立的 HMR 通道，Host 也不监听资源文件。开发时改了 `src/client/assets/` 下的文件，watcher 会重建引用它的 bundle：新资源和新的 `client.js` 一起写出，预设随后重新标记 `client.js`，现有 HMR 替换该插件，重新 materialize 出来的模块就拿到新 URL。
- 构建清理掉旧文件名，旧 URL 自然返回 404，效果与包内 chunk 的旧 rev 规则一致。

### 载体

| 载体 | 行为 |
|---|---|
| HTTP Web | 页面有 `<base href="./">`，`plugins/...` 在 `<img>` 和 style 属性中按文档 base 解析 |
| Desktop | 文档位于 `dsh-app://app/`，`/plugins/` 转发给 Host；转发层把 `/plugins/` 的缓存头一律改为 `no-store`，本提案不改 |
| WebWorker 预览 | `/plugins` 只能经 tunnel 到达，`<img>` 请求到不了 worker 里的 Host；由 WebWorker runtime 自行提供 |

### 门禁

- `check-workspace-constraints`：exports 含 `./assets/*` 时，`files` 必须含 `lib/assets`。
- `verify-client-packages`：`./assets/*` 只能指向 `./lib/assets/*`，只能出现在声明了 `dsh.client` 的包里，并且与包内 Client 源码是否引用资源双向一致（按语法扫描 JS import 和插件 CSS 的 `url()`）。
- `verify-package-dependencies`：`./assets/*` 不是代码导出，不参与依赖分类。

### 首批迁移

| 包 | 资源 | 处理 |
|---|---|---|
| ui-settings-account | 8 张 webp、6 个 svg，已在 `src/client/assets/` | 补导出与 `files` |
| ui-plugin-manager | 4 张预览 svg，已在 `src/client/assets/` | 补导出与 `files`；预览归属不变，同步更新功能预览 Note 和 [预览 cookbook](../../../../docs/cookbook/adding-a-plugin-preview.zh.md) 的交付描述 |
| ui-chat | 鲸鱼 png | 移入 `src/client/assets/`，CSS mask 改为引用该文件，删除包级替换插件 |

插件 CSS 中手写的四处 `data:` 小 SVG 是内联文本，不是文件，保持不变。

### 文档

实现时同步更新：

- Client 模块系统 README：路由、rev 算法、响应头和载体限制；
- 预设模块 JSDoc；
- [Client AGENTS](../../../../packages/client/AGENTS.md)：新包清单与依赖声明；
- [Web 样式](../../../../docs/web-styling.zh.md)：插件 CSS 中 `url()` 的改写规则；
- 首批迁移表中列出的文档。

## Alternatives considered

**保留 data URL。** 不需要路由，但图片字节随 JS 一起下载和解析，而且每个要在样式里用图片的包都得自写构建插件。

**运行时 helper，例如由 factory 的 `require` 提供 `asset(path)`。** URL 在构建时就能确定，运行时 helper 只是多出一个非标准的代码生成目标。Vite 和 webpack 5 asset modules 也是通过 import 得到 URL 字符串。

**前端 Cordis service（`ctx.assets.url(path)`，按调用方 ctx 推出包名）。** 当前消费方都只引用固定文件；而且运行时拿不到内容 hash，还得额外发布每个包的资源清单。等出现需要动态路径的消费方再定。

**资源直接放在包根 `assets/`，不经构建。** 没法在构建期做预处理，命名和格式转换只能手工维护。

**rev 用 `client.js` 的产物 revision。** 这个 revision 要等构建写完后由文件元数据得出，写不进 bundle。

**rev 放在查询串（`?rev=`），Host 校验内容 hash。** Host 必须先读完文件才能决定 200 还是 404，首次请求要读两遍，还要按元数据缓存 hash；把 rev 写进文件名后，Host 只需解析路径并流式发送。

**CSS 只用 JS style 对象引用资源。** 背景、mask 以及 `@supports` 降级本来写在 CSS 里，改成 JS style 会把样式拆到组件里；而 URL 在构建时就能确定，改写 `url()` 和处理 import 用的是同一套规则。


## Acceptance criteria

- 首批三个包构建出的 `client.js` 不含图片 data URL；`lib/assets/` 只含被引用的资源；ui-chat 的包级图片插件已删除，鲸鱼 mask 的 URL 出现在注入的样式文本中。
- 插件 CSS 改写有用例覆盖：相对路径被改写；`data:`、`#片段`、带协议的 URL、以 `/` 开头的路径和空 `url('')` 原样保留；依赖包样式表不改写。
- 以下构建失败情况各有一个拒绝用例：引用 `src/client/assets/` 之外的图片（JS import 与 CSS `url()` 各一个）；引用他包或依赖里的图片；`./assets/*` 未声明或目标不符；Node Client face 中的资源 import。
- Host 路由测试覆盖：
  - 200 及各响应头、304、HEAD、405；
  - 返回 404 的情况：未导出、`..`、`%2e%2e`、编码后的 `..%2f`、解码后的 `%` 和 `#`、目录、未启用的包、表外扩展名；
  - 304 不打开文件；多块文件流式发送完整；shell 载体取消 body 时关闭文件流；
  - `fetchBundle()` 与 HTTP 响应一致。
- 有测试断言类型声明与扩展名表一致。
- 三条门禁各有一个拒绝用例。
- 构建后的 Web e2e 中，引导插图和插件预览经 `plugins/.../assets/...` 加载，`naturalWidth > 0`。
- 改动资源后 watcher 重建，页面经现有 HMR 显示新图。

## Risks

- WebWorker runtime 补上资源加载之前，WebWorker 预览里看不到这些图片。
- Host 不校验文件内容与文件名中的 rev 是否一致：手工改写 `lib/assets/` 里的文件而不改名，浏览器会按 `immutable` 继续用旧缓存。这个目录只由构建写出。
- `require.resolve` 是同步调用，每次请求都在事件循环上做一次同步的文件系统查询（本机实测约 43 µs，文件不存在时约 170 µs）。
- Host 不检查解析结果的真实路径：`lib/assets/` 里若有指向包外的符号链接，会照常提供。这个目录由构建写出，构建只 emit 普通文件。
- Desktop 把缓存头改成 `no-store`，每次显示都要完整读取资源。
- 资源与 bundle 分开请求，首次显示多一次本地请求，图片可能晚于布局出现。
- 第三方插件包要用这条路由，就得自己复刻产出文件名规则；因此它们成为对外约定，记录在 Client 模块系统 README 中。
- `lib/assets/` 的清理依赖两个前提：浏览器 face 是唯一写入方，且每次重建都重新执行所有 load。以后若有其他 face 写这个目录，或启用 rolldown 的增量缓存（被缓存的模块不再 emit 资源），需要调整清理规则。
