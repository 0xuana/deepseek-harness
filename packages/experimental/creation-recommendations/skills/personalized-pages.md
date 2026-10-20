# Personalized pages

Use this workflow in the main conversation to plan an optional persistent page or small interactive tool. The user's need can concern any task or result, not just DSH itself. Wanting a page is not an instruction to develop the application shell, even if the workspace contains its checkout.

Page planning and duplicate checks use only the user's known context and the included catalog. Do not inspect workspace files, source, configuration or APIs to validate a page idea or explain a catalog match. The background Creator handles implementation research after the user clicks Create.

## Choose the smallest useful response

First decide whether a page would serve the current request. An explicit wish for a reusable interface qualifies, including a request to reuse something existing if possible; load this skill to check that page need before deciding to build. A clearly reusable result already obtained for the current task can also qualify: something the user will revisit, update or interact with. First answer the actual request. Ordinary coding tasks, one-off answers, incidental static tables, quoted wishes, discussion-only requests and declined recommendations need no page.

Questions asking only what already exists, how to use a feature or where to open it do not enter page planning. Do not load this skill just to discover plugins. If it is already loaded, those questions still get no creation card. Do not fetch extra data or inspect source/configuration to find a recommendation opportunity. Explicit implementation or debugging requests can still use development tools.

## Check for an existing capability

Only after deciding to plan a page, compare its requested behavior with the current official-plugin descriptions below. This is a duplicate check, not an invitation to discover unrelated features. The catalog is current at load time; reuse it instead of calling another catalog tool in the same turn unless installation state changed.

If an existing capability satisfies the page need, stop page planning. In one short paragraph, give its name, catalog-confirmed purpose, enabled state and entry in Plugins. Do not infer supported providers, setup behavior or extra features, or propose new requirements. An enabled match needs no enable card. For a disabled match, an available plugin-recommendation tool can offer the existing option. The optional-plugin catalog is not a complete inventory of built-in UI, and missing details do not establish that a capability is absent. A partial match does not erase an explicitly requested unmet requirement.

Consider ALL independent needs before choosing ONE card for this turn, even if the user requests two cards. Follow an explicit priority. Otherwise prefer a suitable existing plugin over a new page; the order of mention or a longer description does not establish priority. Mention any remaining need briefly without combining unrelated features or promising an automatic later card. Clarify only missing facts that change the requested outcome.

## Plan and placement

Write one to three sentences in the user's language covering the requested purpose, interactions, input and persistence scope. For example, a per-Session counter with Add and Reset needs those two operations and per-Session storage, not subtraction, history or cross-Session sharing. Keep acceptance criteria tied to those requested behaviors. Do not add optional filters, extra fields, integrations, automation, broader access or deletion policies. Leave source/API research to the background Creator.

Honor a location explicitly requested by the user. Otherwise:

- `sidebar-left`: global feature, with a left entry opening a standalone main-area page without Chat/Trajectory tabs; includes global streaming tools.
- `page`: Session-bound streaming dialogue or interactive assistant, in a tab beside Chat and Trajectory.
- `sidebar-right`: other Session-bound viewers, editors and Context inspection.

For an optional page based on the current result, preserve its known scope. Session-local viewers use `sidebar-right`. Ask only if missing scope or interaction changes the outcome.

## Offer without starting creation

Plan-only or do-not-start requests still permit a proposal, including read-only mode. A proposal creates no page. Only clicking Create starts the background Creator, which builds and hot-installs a new removable plugin. The main conversation remains available; progress, cancellation, retry and removal appear on the card. The info button explains the potentially long generation and substantial token use. Do not wait, poll, require a mode switch or refresh, or ask the user to report back after enabling. Never claim a page has been added before installation.

When offering a new page, call `suggest_action` with `request.action: "create_personalized_page"`, a short `request.title`, a `request.brief` containing the plan, and the selected `request.slot`. A successful result creates the proposal; a rejection creates no card. The final answer contains the answer to any direct question and one short invitation to use the card. For example: “17 + 25 = 42。方案在下方卡片里；点击创建后在后台生成，你可以继续聊天。” For a page-only request: “方案放在下方卡片里，点击创建即可开始。” Adapt the wording and language to the user. The card already contains the plan, location choices, progress and cost notice. Do not append optional features, alternate positions, refresh/report-back instructions, tool narration, card limits or card markup.
