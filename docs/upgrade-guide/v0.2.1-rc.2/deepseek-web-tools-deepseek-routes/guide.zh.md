---
kind: upgrade-guide
description: "DeepSeek 网页搜索以及 DeepSeek Search 与 Fetch API 不再服务于使用其他提供方模型的对话。"
---
# DeepSeek Web 工具只服务于 DeepSeek 模型

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-web-search-deepseek` 以前会向每个对话提供 `web_search`，并且无论对话使用哪个模型，都用 `DEEPSEEK_API_KEY` 搜索。现在它与 `@deepseek-ai/dsh-web-deepseek-api` 的 Search 与 Fetch API 只服务于 `deepseek-official` 与 `deepseek-account` 路由上的模型请求，并且只在其凭据已配置时提供。选中其中之一时，使用其他提供方模型的对话（例如 pi-ai 路由）不会获得 `web_search`；开启**启用新版 Web 搜索 API**时也不会获得 `web_fetch`。为搜索配置的密钥不改变这一点；为这类对话直接调用 `ctx.web.search()` 或 `ctx.web.fetch()` 会以 `WEB_PROVIDER_ROUTE_DISABLED` 失败。

用户在使用其他提供方模型的对话中通过 DeepSeek 搜索或抓取的部署会受影响。

## 迁移

1. 如需在这类对话中搜索，请挂载并选中另一个搜索提供方。该选择对所有对话生效，包括使用 DeepSeek 模型的对话：

   ```yaml
   - name: '@deepseek-ai/dsh-web'
     config:
       searchProvider: exa
   - name: '@deepseek-ai/dsh-web-search-exa'
     config:
       apiKey: !!js process.env.EXA_API_KEY
   ```

2. 如需在这类对话中抓取，请在**插件 > 内置插件配置 > 网页搜索**中关闭**启用新版 Web 搜索 API**并保存，或设置 `web.fetchProvider: http`，由本地 HTTP 抓取提供 `web_fetch`。
3. 在使用其他模型的新对话中确认：其第一个模型请求声明了 `web_search` 与 `web_fetch`。
