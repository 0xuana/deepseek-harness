# Agent Note: 仅在选中的搜索提供方就绪时提供 web_search

Status: implemented

[English](2026-09-27-web-search-offered-by-provider-readiness.md) | 中文

## Problem

`dsh-tool-web` 在启用搜索时总会注册 `web_search`，而 [web 能力 seam 决策](2026-06-24-web-capability-seam.zh.md)让它在选中的提供方无法运行时仍然可见。发行版的搜索提供方 `dsh-web-search-deepseek` 只对 `deepseek-account` 路由上的模型请求使用 DeepSeek 账号 token 鉴权；其他路由都需要已配置的 API 密钥。因此，API 密钥路由上没有搜索密钥的会话会获得一个每次调用都以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败的工具。同一 Host 中的会话可以使用不同路由，一个会话可以在请求之间切换路由，而 Web 应用按 agent preset 只注册一次 `web_search`，因此任何注册层面的决定都无法与每个请求相符。

## Decision

web 能力 seam 的每个角色各负责逐请求检查的一部分：

- **Service Definition。** `WebSearchProvider` 有一个可选的 `ready(llmProvider)`，回答为该对话路由上的模型请求发起的搜索是否有可发送的凭据。它只检查配置，不发起网络调用。`ctx.web.searchReady(llmProvider?)` 按与 `search()` 相同的规则解析提供方并返回其回答。没有 `ready()` 的提供方视为就绪；选择失败时回答 true，因为 `search()` 会把该失败报告为结构化 `WebError`。
- **Service Provider。** 以下情况 `dsh-web-search-deepseek` 回答 true：路由为 `deepseek-account` 且 `ctx.deepseekAccount.resolveToken()` 为配置的搜索端点返回 token；配置段带有字面 `apiKey`；或 `ctx.credentials.describe()` 报告 `apiKeyEnv` 引用已配置（没有该服务时，启动环境中存在该变量）。读取账号 token 或凭据存储失败时按没有凭据处理。提供方不点名任何工具或提示词段落。
- **Consumer。** `dsh-tool-web` 添加一个前置的 `system-prompt/assemble` 监听器。对于每个提供 `web_search` 的组装，它以模型选择写入组装变量的路由询问 `ctx.web.searchReady()`，回答 false 时移除该工具及其 `tool:web_search` 提示词段落。前置使监听器在模型选择之后运行。包含 PTC `run_code` 传输工具的组装原样返回，因为生成的 SDK 独立于工具列表声明 `web_search`。

只看凭据是否存在：不读取密钥的值，也不访问任何端点，因此错误的密钥，或不提供原生 `web_search_20250305` 服务器工具的端点，仍会让该工具保持提供。撤下只改变提供给模型的工具：仍然到达的调用会在运行时解析凭据，并以现有的结构化错误失败。

请求头记录组装后的工具，因此 agent loop（智能体循环）通过工具注册表更新宣告每次变化。路由切换、存储密钥或删除密钥都会改变下一个请求；DeepSeek 路由以延迟加载的新增方式载入重新提供的工具，不支持工具更新的路由则接收完整工具列表。

## Alternatives considered

**让 DeepSeek 提供方在自己的 assemble 监听器中移除 `web_search`。** seam 保持不变，但提供方因此要点名另一个包的工具、提示词段落与 PTC 传输工具；而且即使部署选择了另一个搜索成功的提供方（例如 Exa），它也会移除该工具。

**扩展 `available()`。** 它是同步的且不接收请求，而这项检查要读取异步凭据存储，并取决于请求的路由。依赖路由的 `available()` 还会让提供方选择取决于对话。

**从会话最近的 `request/context` 事件读取路由，而不是传入路由。** 该事件记录的是上一个请求，因此新会话的首个请求，以及模型切换后的首个请求，会按错误的路由判断，或根本没有路由可用。

**在 `dsh-tool-web` 中注册或注销 `web_search`。** 注册由同一 agent preset 的所有会话共享，而凭据取决于每个请求的路由。注销还会使点名 `web_search` 的 `toolOrder` 条目和 subagent `toolFilter` 限制失败。

**为 `dsh-tools` 增加按请求的可见性谓词。** 它也能覆盖 PTC SDK，但会为一个工具的需要给核心包增加通用的工具可用性 API。

**保持工具可见，在执行时失败。** 模型会把一次调用花在无法鉴权的搜索上，并且每次尝试都会重复失败。

**提供工具前探测密钥或端点。** 每个模型请求都发起一次网络请求会增加延迟与成本；用户控制的是配置本身，而不是它在那一刻是否有效。

## Consequences

`dsh-web` 增加两个公共成员：可选的 `WebSearchProvider.ready()` 与 `WebRuntime.searchReady()`。`searchReady()` 是其唯一消费方所需的最小查询，这正是[观测接口决策](../../archived/simplification/2026-07-04-drop-unconsumed-web-observation-surface.md)允许状态查询回归的方式；它既不报告可用性，也不报告选择失败。Exa 与 Perplexity 提供方没有实现 `ready()`，其行为不变。PTC 呈现在没有凭据时仍然提供 `web_search`。无法提供原生服务器工具的端点仍会让工具保持提供，并使每次调用失败。在路由不变时移除工具会改变声明的工具，并使提示词缓存失效一次；模型切换本身已经使缓存失效。

单元测试分别固定每个角色：`packages/web/web/tests/web.spec.ts` 覆盖 `searchReady()` 询问哪个提供方以及选择失败时的回答，`packages/web/web-search-deepseek/tests/deepseek.spec.ts` 覆盖 `ready()` 的每种凭据情况，`packages/web/tool-web/tests/tool-web.spec.ts` 通过真实的提示词、工具与模型选择服务进行组装。发行版 headless 无密钥冒烟测试与 `web-search-unconfigured` 录制会话快照在真实组合中固定了撤下行为。快照回放提供占位 DeepSeek 密钥，因此其工具列表不依赖运行环境。
