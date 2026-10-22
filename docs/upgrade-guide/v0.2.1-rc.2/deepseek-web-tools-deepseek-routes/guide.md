---
kind: upgrade-guide
description: "DeepSeek web search and the DeepSeek Search and Fetch APIs serve conversations on other providers' models only with a key of their own."
---
# DeepSeek web tools need their own key for other models

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-web-search-deepseek` used to offer `web_search` to every conversation and search with `DEEPSEEK_API_KEY` whatever model the conversation used. It and the Search and Fetch APIs of `@deepseek-ai/dsh-web-deepseek-api` now serve model requests on the `deepseek-official` and `deepseek-account` routes while their credential is configured, and model requests on other routes only when the provider has a key of its own: a literal `apiKey`, or an `apiKeyEnv` other than `DEEPSEEK_API_KEY`. Without one, a conversation on another provider's model, such as a pi-ai route, is not offered `web_search`; with **Use the new Web Search API** turned on, it is not offered `web_fetch` either, and a direct `ctx.web.search()` or `ctx.web.fetch()` for it fails with `WEB_PROVIDER_ROUTE_DISABLED`. The key the Web search settings page saves is the shared `DEEPSEEK_API_KEY` and does not count.

Deployments whose users search or fetch through DeepSeek from conversations on other providers' models are affected.

## Migration

1. To keep DeepSeek search in those conversations, give the selected provider its own key reference, for example `web-search-deepseek.apiKeyEnv: DEEPSEEK_SEARCH_API_KEY`, or `web-deepseek-api.apiKeyEnv` with the Search and Fetch APIs selected. Then save the key on the Web search settings page, which stores it under that reference, or export the variable.
2. Alternatively, mount another search provider and select it. The selection applies to every conversation, including those on DeepSeek models:

   ```yaml
   - name: '@deepseek-ai/dsh-web'
     config:
       searchProvider: exa
   - name: '@deepseek-ai/dsh-web-search-exa'
     config:
       apiKey: !!js process.env.EXA_API_KEY
   ```

3. To fetch from those conversations without a key of the APIs' own, turn off **Use the new Web Search API** in **Plugins > Built-in plugin settings > Web search** and save, or set `web.fetchProvider: http`, so local HTTP fetch serves `web_fetch`.
4. Confirm with a new conversation on the other model: its first model request declares `web_search` and `web_fetch`.
