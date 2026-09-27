# Agent Note: DeepSeek 搜索从没有凭据的请求中撤下 web_search

Status: implemented

[English](2026-09-27-deepseek-search-withholds-web-search-without-credentials.md) | 中文

## Problem

`dsh-tool-web` 在启用搜索时总会注册 `web_search`，而 [web 能力 seam 决策](2026-06-24-web-capability-seam.zh.md)让它在选中的提供方无法运行时仍然可见。发行版的搜索提供方 `dsh-web-search-deepseek` 只对 `deepseek-account` 路由上的模型请求使用 DeepSeek 账号 token 鉴权；其他路由都需要已配置的 API 密钥。因此，API 密钥路由上没有搜索密钥的会话会获得一个每次调用都以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败的工具。同一 Host 中的会话可以使用不同路由，一个会话可以在请求之间切换路由，而 Web 应用按 agent preset 只注册一次 `web_search`，因此任何注册层面的决定都无法与每个请求相符。

## Decision

`dsh-web-search-deepseek` 添加一个前置的 `system-prompt/assemble` 监听器。对于每个提供 `web_search` 的组装，除非该请求将发起的搜索具有凭据，否则它会移除该工具与 `tool:web_search` 提示词段落：

- 请求的 `provider` 变量为 `deepseek-account`，且 `ctx.deepseekAccount.resolveToken()` 为配置的搜索端点返回 token；
- 配置段带有字面 `apiKey`；或
- `ctx.credentials.describe()` 报告 `apiKeyEnv` 引用已配置；没有该服务时，启动环境中存在该变量。

只看凭据是否存在。监听器不读取密钥的值，也不访问任何端点，因此错误的密钥，或不提供原生 `web_search_20250305` 服务器工具的端点，仍会让该工具保持提供。读取账号 token 或凭据存储失败时按没有凭据处理。

监听器是前置的，因此它在模型选择把本请求的路由写入组装变量之后运行。包含 PTC `run_code` 传输工具的组装原样返回，因为生成的 SDK 独立于工具列表声明 `web_search`。撤下只改变提供给模型的工具：仍然到达的调用会在运行时解析凭据，并以现有的结构化错误失败。

请求头记录组装后的工具，因此 agent loop（智能体循环）通过工具注册表更新宣告每次变化。路由切换、存储密钥或删除密钥都会改变下一个请求；DeepSeek 路由以延迟加载的新增方式载入重新提供的工具，不支持工具更新的路由则接收完整工具列表。

## Alternatives considered

**在 `dsh-tool-web` 中注册或注销 `web_search`。** 注册由同一 agent preset 的所有会话共享，而凭据取决于每个请求的路由。注销还会使点名 `web_search` 的 `toolOrder` 条目和 subagent `toolFilter` 限制失败。

**为 `ctx.web` 增加就绪查询，并为 `dsh-tools` 增加按请求的可见性谓词。** 这样决定留在工具所有者处，也能覆盖 PTC SDK，但会为一个提供方的凭据规则给两个核心包增加公共 API，并给 `dsh-agent` 增加路由访问器。

**保持工具可见，在执行时失败。** 模型会把一次调用花在无法鉴权的搜索上，并且每次尝试都会重复失败。

**提供工具前探测密钥或端点。** 每个模型请求都发起一次网络请求会增加延迟与成本；用户控制的是配置本身，而不是它在那一刻是否有效。

## Consequences

提供方修改了 `dsh-tool-web` 拥有的工具列表，并点名该包的工具与提示词段落。该检查假定由 DeepSeek 负责搜索：加载本提供方但选择其他提供方的组合，只要 DeepSeek 没有凭据，仍会失去 `web_search`。PTC 呈现在没有凭据时仍然提供 `web_search`。无法提供原生服务器工具的端点仍会让工具保持提供，并使每次调用失败。在路由不变时移除工具会改变声明的工具，并使提示词缓存失效一次；模型切换本身已经使缓存失效。

`packages/web/web-search-deepseek/tests/deepseek.spec.ts` 中的单元测试通过真实的提示词、工具与模型选择服务进行组装。发行版 headless 无密钥冒烟测试与 `web-search-unconfigured` 录制会话快照在真实组合中固定了撤下行为。快照回放提供占位 DeepSeek 密钥，因此其工具列表不依赖运行环境。
