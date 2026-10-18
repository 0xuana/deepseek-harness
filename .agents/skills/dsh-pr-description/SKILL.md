---
name: dsh-pr-description
description: Use when creating a deepseek-harness pull request, or when updating its description after a later push or a handled review round. Defines each description section, Issue references, test design, change-specific disclosures, and the Human and Agent Roles section with its levels, stages, grading rules, and update timing.
user-invocable: false
---

# Writing PR descriptions

This skill defines what a deepseek-harness PR description contains, how to write it, and when to update it. The [PR template](../../../.github/pull_request_template.md) supplies only the section headings and placeholders; this skill owns the requirements for each section. Every PR description follows this skill, including PRs created with `gh pr create --body-file`, which skips the template.

## Scope

- Write the complete description when you create the PR.
- After the PR exists, update the affected sections after each later push and after each handled review round.
- Each PR in a stack has its own description, which covers only that layer's changes against its base branch.

## Description structure

The description uses four second-level headings, in this order: `## Motivation`, `## Changes`, `## Testing`, and `## Human and Agent Roles`.

### Motivation

- State the problem in one sentence.
- Reference at least one same-repository Issue: use `Fixes #N`, `Closes #N`, or `Resolves #N` when the PR resolves it, and `Refs #N` when it only gives context. PR numbers do not count as Issue references, and neither do references inside HTML comments, code fences, or inline code. [Issue management](../../../.github/issue-management/README.md) owns the exact rules and the Priority matching.

### Changes

- Interface changes: summarize changes to commands, configuration, APIs, protocols, or persisted formats; write None when there are none.
- Behavior changes: summarize changes that users, models, or the system can observe; write None when there are none.

### Testing

Testing starts with the test design, followed by the test entries.

**Test design**: summarize how the tests cover each item in Changes and why that coverage is complete. Choose the form by change type:

| Change type | What the test design shows |
|---|---|
| Behavior change | A behavior matrix of scenario × behavior before × behavior after × covering test, showing which scenarios failed or differed before the change |
| Performance change | Before and after values per stage or scenario, with the measurement conditions: machine, run count, and how the value is taken |
| Refactoring or migration without behavior change | How the unchanged behavior is shown: byte-for-byte comparison, unchanged snapshots, or old-versus-new comparison tests |
| Documentation only | How the content is checked: links, bilingual pairing, example compilation, or similar |

Items that Changes lists as None need no test design.

**Test entries**:

- Add one entry per test method; state the command or steps visibly, and the behavior it covers.
- Put reviewable evidence, such as test output, screenshots, recordings, or logs, in that entry's `<details><summary>Proof</summary>` block.

### Change-specific disclosures

| Change | What the description states | Rule owner |
|---|---|---|
| Changing the behavior an existing test describes | Why the behavior changed | The Tests describe behavior rule in [root AGENTS.md](../../../AGENTS.md) |
| Raising a ceiling in `scripts/doc-budgets.manifest.json` | Why the words are necessary | [Wordcount budgets](../../../docs/AGENTS.md#wordcount-budgets) |
| Changing product-user-visible GUI behavior | An embedded demonstration GIF, with the disclosures that record-browser-gif requires beside the embed | [record-browser-gif](../record-browser-gif/SKILL.md#every-gui-pull-request-includes-a-gif) |
| Using a translation term the terminology list lacks | The source of the rendering, or a proposed rendering under pending terms | [Translation rules](../../../docs/i18n/translation-rules.md) |

## Human and Agent Roles

This section records who made the decisions in each stage of the PR, and how autonomously the Agent worked.

### Levels

<!-- TODO: calibrate the autonomy ranges, the stage criteria, and the example together. -->

Levels are ordered from least to most AI involvement; each level pairs an English name with a Chinese name. Autonomy is the Agent's autonomy in that stage, a multiple of 5% within the chosen level's range.

| Level | Meaning | Agent autonomy |
|---|---|---|
| hint 人工独立 | A human does the work; AI takes no part or only offers passive suggestions that the human accepts or rejects | 0–15% |
| assist 人工主导 | A human supplies the main content or every key decision; AI completes part of the work | 20–40% |
| pair 人工引导 | A human gives the key direction or constraints and revises the AI's output several times; the human understands the internals | 45–60% |
| copilot 人工把关 | AI completes the whole task; a human reviews, selects, or rejects, and decides or clarifies key points without supplying substantive content | 65–85% |
| auto 模型自主 | AI completes the task autonomously; a human only sets the goal or accepts the output | 90–100% |
| n/a 暂不适用 | The stage does not exist or has not happened yet | Omitted |

### Stages and criteria

Stages appear in a fixed order; each stage pairs an English name with a Chinese name. The criteria below cover assist through auto; judge hint by its meaning in the level table.

**breakdown 问题拆解**: after the problem appears, whether a human takes part in breaking it down, or the Agent acts on it directly.

- auto 模型自主: the Agent acts on the problem directly.
- copilot 人工把关: the Agent identifies the subproblems, root cause, and scope; a human confirms or trims them.
- pair 人工引导: a human points to a suspected direction, a key subproblem, or a scope limit, or requires tracing the root cause.
- assist 人工主导: a human supplies the list of subproblems or the root-cause judgment and sets the scope; the Agent works from that breakdown.

**design 方案设计**: who supplies the logical design, and how many trade-offs and detailed changes the human makes.

- auto 模型自主: a human adopts the Agent's design as proposed, or only confirms an option the Agent recommends.
- copilot 人工把关: a human chooses among the Agent's designs, or rejects parts of one.
- pair 人工引导: the Agent proposes the design structure; a human gives key constraints, names, or several revisions.
- assist 人工主导: a human supplies the design structure (module split, data flow, or key interfaces); the Agent fills in the mechanism or writes it up.

**testing 验收测试**: who sets the acceptance goals, test cases, and test matrix, and who checks the results. For documentation-only changes, the acceptance goals are content requirements.

- auto 模型自主: the Agent sets the goals and cases, and no human reviews them.
- copilot 人工把关: a human reviews the cases, the test matrix, or the results the Agent reports.
- pair 人工引导: a human sets quantified targets or required scenarios; the Agent designs the concrete cases.
- assist 人工主导: a human defines the goals and the test matrix, and runs or tries the result to check it.

**implementation 技术实现**: human intervention in the changed content, including production code, documentation (READMEs, JSDoc, Agent Notes, comments), CI, and release scripts.

- auto 模型自主: the Agent writes every change, and the records show no human diff review.
- copilot 人工把关: a human reviews the diff, including staging it piece by piece, and accepts it or makes a few comments.
- pair 人工引导: a human requires reverting or redoing work, or specifies a refactoring or an implementation approach.
- assist 人工主导: a human writes the key parts; the Agent completes the rest.

**review 评审处理**: who decides whether each handled review comment is fixed or declined. Comments from bots and from people both count; grade by who decided, not by who posted the reply.

- auto 模型自主: the Agent decides on and replies to every comment.
- copilot 人工把关: a human gives only a blanket authorization or category-level instructions, or changes only a few items on a handling list the Agent prepared.
- pair 人工引导: a human decides comment by comment whether to fix, decline, or defer every comment other than wording comments, which may be handled by category; the Agent carries out the decisions and replies.
- assist 人工主导: a human replies to reviewers directly, or leads the discussion of disputed items.

### Grading rules

- Grade from session records and task records. Messages a human sends in a subagent session count; the instructions an Agent writes to a subagent are not human messages.
- Count only work that ends up in this PR, including work from earlier sessions that ends up in this PR.
- When the records suffice, grade at the level with the most human involvement whose criterion the records meet, and express the human and Agent shares through the autonomy value. Only when the records do not suffice, take the level with less human involvement that the records support.
- When a stage covers several changes, grade by the main change and state how the other changes differ in the description.

### Line format

The section starts with one level line, followed by one line per stage in the fixed order:

```markdown
## Human and Agent Roles

Levels and Agent autonomy: <ins>**hint 人工独立**</ins> 0–15%, <ins>**assist 人工主导**</ins> 20–40%, <ins>**pair 人工引导**</ins> 45–60%, <ins>**copilot 人工把关**</ins> 65–85%, <ins>**auto 模型自主**</ins> 90–100%; <ins>**n/a 暂不适用**</ins> marks a stage that does not exist or has not happened yet.

- <ins>**<level English name> <level Chinese name>**</ins> <autonomy> · <stage English name> <stage Chinese name> — <description>
```

- Write the level in bold and underlined; omit the autonomy value for n/a 暂不适用.
- Write the description in the PR description's language, in one or two sentences of at most 80 Chinese characters or 40 English words. State who made which decisions: name one or two representative decisions, and give only a count for the rest.
- State the description as settled fact, without hedges such as "not seen in the session" or "pending author confirmation".
- Refer to people as the author or a reviewer, never by username. Leave out judgments, session times, session ids, direct quotes, and the running or handling of checks and CI (local skips, hooks, reruns, unrelated failures).

### Update timing

- When you create the PR, the review line reads `- <ins>**n/a 暂不适用**</ins> · review 评审处理 — ` followed by a statement, in the description's language, that no review comments have been handled yet.
- After the PR exists, after each later push and after each handled review round, rewrite the affected lines so that they cover all work so far; do not append a history of changes.
- The review line records only handled review comments; it omits approvals, merge timing, and unhandled comments.

### Example

Filled in from the session and review records of #6013:

```markdown
- <ins>**pair 人工引导**</ins> 45% · breakdown 问题拆解 — The author identified two process-specific values that do not belong in the system prompt and pointed to the custom model route; the Agent traced the root cause.
- <ins>**assist 人工主导**</ins> 25% · design 方案设计 — The author supplied the design structure: runtime context, frozen legacy sections for old sessions, and a separate package; the Agent filled in the projection matching.
- <ins>**pair 人工引导**</ins> 50% · testing 验收测试 — The author required two scenarios: restoring an old session after upgrade, and changing ports after upgrade; the Agent wrote the cases and snapshots.
- <ins>**pair 人工引导**</ins> 45% · implementation 技术实现 — The Agent wrote the code and the Agent Note; the author required one revert and specified 3 approaches, such as getOrigin() instead of an origin property.
- <ins>**pair 人工引导**</ins> 50% · review 评审处理 — The author decided each bot comment, such as no upgrade guide and keeping a devDependency; the Agent fixed and replied.
```

## Creating and updating the description

1. Write the description to a file that git ignores, such as `.artifacts/pr/body.md`. Create the PR with `gh pr create --body-file <file>`, or update it with `gh pr edit <number> --body-file <file>`; when the description embeds a GIF, follow [record-browser-gif](../record-browser-gif/SKILL.md) and use `--attach`.
2. Before an update, save the current description with `gh pr view <number> --json body --jq .body`, and change only the sections that need it: keep content and media the author wrote, and remove statements that no longer match the code.
3. After writing, read the description back and confirm that all four sections are present and that Human and Agent Roles matches the current code and review state.
