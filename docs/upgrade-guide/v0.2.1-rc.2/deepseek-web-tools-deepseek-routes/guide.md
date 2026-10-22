---
kind: upgrade-guide
description: "DeepSeek web search and the DeepSeek Search and Fetch APIs no longer serve conversations on other providers' models."
---
# DeepSeek web tools serve only DeepSeek models

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-web-search-deepseek` used to offer `web_search` to every conversation and search with `DEEPSEEK_API_KEY` whatever model the conversation used. It and the Search and Fetch APIs of `@deepseek-ai/dsh-web-deepseek-api` now serve only model requests on the `deepseek-official` and `deepseek-account` routes, and only while their credential is configured. While one of them is selected, a conversation on another provider's model, such as a pi-ai route, is not offered `web_search`; with **Use the new Web Search API** turned on, it is not offered `web_fetch` either. A key configured for search does not change this, and a direct `ctx.web.search()` or `ctx.web.fetch()` for such a conversation fails with `WEB_PROVIDER_ROUTE_DISABLED`.

Deployments whose users search or fetch through DeepSeek from conversations on other providers' models are affected.

## Migration

1. To search from those conversations, mount another search provider and select it. The selection applies to every conversation, including those on DeepSeek models:

   ```yaml
   - name: '@deepseek-ai/dsh-web'
     config:
       searchProvider: exa
   - name: '@deepseek-ai/dsh-web-search-exa'
     config:
       apiKey: !!js process.env.EXA_API_KEY
   ```

2. To fetch from those conversations, turn off **Use the new Web Search API** in **Plugins > Built-in plugin settings > Web search** and save, or set `web.fetchProvider: http`, so local HTTP fetch serves `web_fetch`.
3. Confirm with a new conversation on the other model: its first model request declares `web_search` and `web_fetch`.
