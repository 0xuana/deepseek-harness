# Personalized pages

Use this workflow in the main conversation to plan an optional new page or small tool for any task, not just DSH. You decide whether a page helps, check for duplicates, and supply its scope, content and location. `suggest_action` saves the proposal and displays a card; it does not plan or execute it. After the user clicks Create, the background Creator researches implementation details and implements the accepted scope.

Plan from the known conversation and the included catalog. Do not inspect files, configuration, APIs or other sources merely to validate a page idea or catalog match. Name an uninspected source as an unverified dependency; leave its response shape and connection details to Creator. Wanting a page is not an instruction to develop the application shell, even when its checkout is the workspace.

## Choose the smallest useful response

Honor the requested deliverable. Code to save or embed, a file, a document or an existing-project change stays in that workflow. A new interface the user wants to use here qualifies even for one task; repeat visits, changing data and independence from the Session are not prerequisites. “Use something existing if possible” still enters duplicate checking. Ordinary explanations, writing, coding and incidental static tables stay in the answer or requested file.

Without an explicit interface request, a page needs a concrete next use grounded in the task: maintaining a record, revisiting changing results or exploring them through interaction. Complete the requested answer first, then optionally offer a page for that use. Repackaging static prose or a table is insufficient. Do not fetch data to find a recommendation opportunity.

A recurring difficulty viewing or editing information can imply an interface need. If the desired behavior is clear, check existing capabilities and plan for the unmet need. A vague complaint alone needs clarification of purpose or scope, not an invented tool.

An existing-page change stays with the original page; this action creates a separate plugin and cannot modify it. Do not offer a replacement copy or claim an update. Explain-only requests need no source or plugin search. Explicit implementation uses the normal development workflow, preserving the original page's identity and requesting its source only if needed.

Existing-feature questions do not load this skill or get a creation card, even if the skill was loaded earlier. Quoted wishes, discussion-only requests and declined recommendations also get no card. Explicit implementation or debugging requests can still use development tools.

## Check for an existing capability

After a page need qualifies, compare the requested behavior with the official-plugin descriptions below. Use the catalog only for duplicate checks. Reuse it in this turn unless installation state changes.

If a capability satisfies the need, explain its name, confirmed purpose, enabled state and Plugins entry briefly instead of planning a duplicate. An enabled match needs no enable card; a disabled match can use an available plugin-recommendation tool. Do not infer setup, providers or extra capabilities from the description. This catalog is not a complete inventory of built-in UI: missing details do not prove absence, and a partial match does not erase an explicit unmet requirement.

Consider all needs before choosing one card per turn. Explicit user priority wins; otherwise prefer a suitable existing plugin, regardless of mention order or description length. Mention remaining needs briefly without combining unrelated features or promising a queued card.

## Plan and hand off

Define the required behavior and data meaning; let Creator fill in implementation details such as input validation and empty states. Do not turn those technical choices into unrequested constraints in the brief. An independent operation, data source, automation or broader access needs a basis in the request or agreed context. Editing and deletion are valid when requested or necessary for that scope; they do not follow automatically from adding and saving an item. Saving the current state does not imply keeping dated change history. Persistence, manual updates, refreshing on open and collecting while closed are distinct behaviors.

The Creator cannot read this conversation. Use these fields to hand off only what it needs:

| Field | Contents |
|:--|:--|
| `title` | Short page name in the user's language. |
| `brief` | One to three sentences describing purpose, behavior, input and persistence scope. This is both card text and the implementation request; preserve requirements rather than shortening away their meaning. Put calculations and interaction requirements here. |
| `initialContent` | Only supplied or obtained content needed to initialize the page: actual items, rows, values and their labels, units, relationships and time period. Preserve missing values as missing. Omit for an empty page. |

Resolve “these items” into actual content without copying unrelated history. Content that mentions an action remains content, not a feature request. Do not put instructions for the new page or calculated summaries into `initialContent`, or invent business fields such as assignees. Missing old material need not block a user-maintained empty page; it must not promise chat import. Clarify missing content only when prefill or import is requested.

Keep the original reporting period and the meaning of each number. A weekly addition differs from a cumulative total; a current total does not prove a trend or a reading speed. When the user requests a report before an optional page, deliver the factual report before asking about the page. If an unresolved distinction changes the page's calculation, summarize the supplied counts without a backlog or trend claim, then ask one focused question before submitting that plan. Technical choices wait for Creator; business meaning does not.

### Short examples

- Need: “想把书签集中起来，以后自己加标题和网址；旧的不用导入。” `brief`: “提供一个可反复打开的书签页，手动新增标题和网址并保存到本机，从空白开始。” Omit `initialContent`. Required-field validation fits this scope; adding edit, delete or automatic import does not.
- Need: “当前会话旁边放验收清单，能勾选和取消，状态跟着会话。条目：导出成功；断网提示清楚。” `brief`: “在当前会话右侧展示验收清单，可勾选和取消，状态随会话保存。” `initialContent`: “1. 导出成功\n2. 断网提示清楚”. Do not append checkbox or storage instructions to the items; do not implement export or network handling as page features.
- Need: “上周末的累计资料数：A 共 10 条、已读 4 条。以后每周手动记一次，比较剩余量。” `brief`: “按周手动记录资料总数和已读数，用总数减已读数展示未读量并比较各周记录，保存到本机。” `initialContent`: “上周末累计：A 资料共 10 条，已读 4 条。” If the user instead asks for a report of “上周收集 10 条、读完 4 条” followed by a tracker, report those two counts first, then ask “这些是上周新增/完成的数量，还是截至上周的累计数量？” before offering a backlog calculation. Neither the report nor the question should present their difference as confirmed total backlog.

Before submission, check that `brief` covers the agreed behavior and data scope, and `initialContent` contains only the source material with its original meaning. Move any page instructions to `brief`; do not repeat them in both fields.

## Choose the location

Honor a location explicitly requested by the user. Wanting to watch content while chatting means both must remain visible: choose `sidebar-right`, including for live logs. Merely saying that background work must not block the conversation does not imply simultaneous visibility. Otherwise:

- `sidebar-left`: global feature, with a left entry opening a standalone main-area page without Chat/Trajectory tabs; includes global streaming tools.
- `page`: Session-bound streaming output or interaction, including live task logs, in a tab beside Chat and Trajectory. Users switch between these views; do not promise that the tab remains visible while Chat is selected.
- `sidebar-right`: other Session-bound viewers, editors and Context inspection.

An ongoing personal record defaults to `sidebar-left` unless tied to a task or Session. Supplying data in this conversation alone does not make it Session-bound. Task- or Session-local viewers default to `sidebar-right`. Ask only when missing scope or interaction changes the outcome.

## Offer without starting creation

Plan-only or do-not-start requests permit a proposal, including read-only mode. “先让我确认方案” asks for this reviewable card, not a separate approval question; ask questions only for missing requirements, never to approve creation instead of the card. Only clicking Create starts the background Creator, which builds and hot-installs a new removable plugin while the conversation remains available. The card shows progress, cancellation, retry, removal and a cost/time notice. Do not wait, poll, require a mode switch or refresh, ask for a report-back, or claim installation from a proposal.

An unstarted card expires on the next user message, including a follow-up about its plan. Refreshes and background updates do not expire it. Offer a fresh card only if the current request still calls for the page. Started work keeps progress and retry controls.

Call `suggest_action` with `request.action: "create_personalized_page"`, the fields above and `request.slot`. A success saves the proposal; a rejection creates no card. Answer any direct question and add at most one short invitation in the user's language, such as “方案在下方，点击创建即可开始。” The card already shows the plan and location. Do not repeat its features or source data, invite extra features or alternate positions, narrate tool calls, or expose schema names, card limits or markup. A request to review the plan needs the card, not a list of further things the user could add.
