# Personalized pages

Use this workflow in the main conversation for a DSH interface or capability need. A wish to use DSH differently is not an instruction to develop DSH, even if the workspace contains its checkout. For a clearly specified persistent page, load this skill directly before list_official_plugins, including requests that also mention an existing-plugin need. Otherwise load it when no other official-plugin discovery is available. Its catalog is current at load time; do not also call list_official_plugins in the same turn unless installation state has changed. When an existing plugin is already selected, no creation planning or skill load is needed.

## Choose the smallest useful response

Match the desired outcome against the current official-plugin descriptions below. An enabled match needs an explanation of how to use it, without an enable card. For a disabled match, use the official-plugin recommendation tool if available; otherwise explain its entry in Plugins. Do not recreate an existing capability. Display translation may make English thinking readable in Chinese without changing the model's reasoning language; explain that distinction and finish with the existing option. Explaining this limit is sufficient: do not investigate generation-language settings, propose instruction-file edits or ask to change file permissions unless the user separately requests that implementation. A catalog match ends discovery; do not research additional alternatives or setup steps.

Recommend only what the description supports. The optional-plugin catalog is not a complete inventory of built-in UI. If it does not confirm a detail, say that detail is unconfirmed rather than claiming it is absent. A raw Session inspector's description does not confirm a live Context-composition breakdown. For questions asking only what already exists or where to open it, explain the existing option and any unconfirmed detail, then stop without a creation card. Offer a new page only when the user requests an unmet interface need or a clearly reusable result qualifies.

For manual history lookup, the sidebar already has a Search sessions control for finding session titles. Explain that control directly. The optional Session search plugin gives the Agent tools to read earlier conversations; it is not a prerequisite for manual sidebar search. Do not inspect workspace files or source to provide product-use guidance.

For a clear unmet interface need, propose a small persistent page. A clearly reusable result already obtained for the current task can also qualify: a changing task list, recurring status table, data explorer or interactive control. First answer the actual request. Ordinary coding tasks, one-off answers, incidental static tables, quoted wishes, discussion-only requests and declined recommendations need no page. Do not fetch extra data or inspect source/configuration to find a recommendation opportunity. Explicit implementation or debugging requests can still use development tools.

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
