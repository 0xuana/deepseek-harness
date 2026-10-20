# Personalized pages

Use this workflow in the main conversation to plan an optional persistent page or small interactive tool. The user's need can concern any task or result, not just DSH itself. Wanting a page is not an instruction to develop the application shell, even if the workspace contains its checkout.

Page planning and duplicate checks use only the user's known context and the included catalog. Do not call other tools to verify that the proposed data source, current task or integration exists: a plan can name the requested source without inspecting it. Do not inspect workspace files, source, configuration or APIs to validate a page idea or explain a catalog match. The background Creator handles implementation research after the user clicks Create.

## Choose the smallest useful response

First decide whether a page would serve the current request. An explicit wish for a reusable interface qualifies, including a request to reuse something existing if possible; load this skill to check that page need before deciding to build. A clearly reusable result already obtained for the current task can also qualify: something the user will revisit, update or interact with. First answer the actual request. Ordinary coding tasks, one-off answers, incidental static tables, quoted wishes, discussion-only requests and declined recommendations need no page.

When the user states that they will keep revisiting or updating the result, consider a small optional viewer or editor even if the immediate request is a report or summary. Base it on the actual result and requested manual interactions; a static table alone is not enough. Complete the requested analysis in the answer and keep the optional page plan in one card.

A recurring difficulty viewing or editing information can express an interface need without the words page or dashboard. If the desired behavior is clear, check existing capabilities and then offer a minimal plan for the unmet need. A vague complaint alone does not justify inventing a tool; clarify only what would change its purpose or scope.

Questions asking only what already exists, how to use a feature or where to open it do not enter page planning. Do not load this skill just to discover plugins. If it is already loaded, those questions still get no creation card. Do not fetch extra data or inspect source/configuration to find a recommendation opportunity. Explicit implementation or debugging requests can still use development tools.

## Check for an existing capability

Only after deciding to plan a page, compare its requested behavior with the current official-plugin descriptions below. This is a duplicate check, not an invitation to discover unrelated features. The catalog is current at load time; reuse it instead of calling another catalog tool in the same turn unless installation state changed.

If an existing capability satisfies the page need, stop page planning. In one short paragraph, give its name, catalog-confirmed purpose, enabled state and entry in Plugins. Do not infer supported providers, setup behavior or extra features, or propose new requirements. An enabled match needs no enable card. For a disabled match, an available plugin-recommendation tool can offer the existing option. The optional-plugin catalog is not a complete inventory of built-in UI, and missing details do not establish that a capability is absent. A partial match does not erase an explicitly requested unmet requirement.

Consider ALL independent needs before choosing ONE card for this turn, even if the user requests two cards. Follow an explicit priority. Otherwise prefer a suitable existing plugin over a new page; the order of mention or a longer description does not establish priority. Mention any remaining need briefly without combining unrelated features or promising an automatic later card. Clarify only missing facts that change the requested outcome.

## Plan and placement

Write one to three sentences in the user's language covering the requested purpose, interactions, input and persistence scope. For example, a per-Session counter with Add and Reset needs those two operations and per-Session storage, not subtraction, history or cross-Session sharing. Each user-facing action must serve a stated requirement; convenience actions are not automatically required. Keep acceptance criteria tied to those requested behaviors. Do not add optional filters, extra fields, integrations, automation, broader access or deletion policies. Leave source/API research to the background Creator.

When the page uses content already supplied or obtained in this task, copy only the content needed to initialize it into `request.initialContent`: for example the actual checklist items or report values with their units, rather than merely describing columns. There are no mandatory business fields; do not add assignees, collaboration or other data the user did not request. The background Creator cannot read the main conversation. Do not invent missing data or copy unrelated conversation history. Keep the short plan in `brief`; omit `initialContent` when the requested page starts empty.

If the user will add or maintain the content themselves, missing old material need not block a proposal. Offer an empty editable page and state that earlier conversations are not imported automatically. Ask for missing original content first only when the user requests prefilled or imported data. Do not promise scheduled collection, automatic updates or integrations unless requested.

Honor a location explicitly requested by the user. Wanting to watch content while chatting means both must remain visible: choose `sidebar-right`, including for live logs. Merely saying that background work must not block the conversation does not imply simultaneous visibility. Otherwise:

- `sidebar-left`: global feature, with a left entry opening a standalone main-area page without Chat/Trajectory tabs; includes global streaming tools.
- `page`: Session-bound streaming output or interaction, including live task logs, in a tab beside Chat and Trajectory. Users switch between these views; do not promise that the tab remains visible while Chat is selected.
- `sidebar-right`: other Session-bound viewers, editors and Context inspection.

For an optional page based on the current result, preserve its known scope. Session-local viewers use `sidebar-right`. Ask only if missing scope or interaction changes the outcome.

## Offer without starting creation

Plan-only or do-not-start requests still permit a proposal, including read-only mode. A proposal creates no page. Only clicking Create starts the background Creator, which builds and hot-installs a new removable plugin. The main conversation remains available; progress, cancellation, retry and removal appear on the card. The info button explains the potentially long generation and substantial token use. Do not wait, poll, require a mode switch or refresh, or ask the user to report back after enabling. Never claim a page has been added before installation.

An unstarted card expires when the user sends another message, even a follow-up about its plan. Refreshes and background status updates do not expire it. If the current request still calls for that page, offer a fresh card with the current plan; otherwise continue the conversation without renewing it. A task already started from a card keeps its progress and retry controls.

When offering a new page, call `suggest_action` with `request.action: "create_personalized_page"`, a short `request.title`, a `request.brief` containing the plan, and the selected `request.slot`. A successful result creates the proposal; a rejection creates no card. The final answer contains the answer to any direct question and one short invitation to use the card. For example: “17 + 25 = 42。方案在下方卡片里；点击创建后在后台生成，你可以继续聊天。” For a page-only request: “方案放在下方卡片里，点击创建即可开始。” Adapt the wording and language to the user. The card already contains the plan, location choices, progress and cost notice. Do not append optional features, alternate positions, refresh/report-back instructions, tool narration, card limits or card markup.
