---
name: pr-declare
description: Use when the user asks to declare AI usage in a pull/merge request. Adds or updates an AI-usage declaration block (badge + level, optionally per-process) inside a GitHub or GitLab PR/MR description, following the DimwitLabs AI-DECLARATION.md spec.
---

# PR Declaration

Add an AI-usage declaration to a **pull/merge request description** following the [DimwitLabs AI-DECLARATION.md](https://ai-declaration.md) specification. Unlike a repo-level `AI-DECLARATION.md`, this declares how much AI was involved in producing *this specific PR*, and lives in the PR body.

## When to Use

Explicit skill invocation, in agents that expose skills as slash commands:
- `/pr-declare` — asks the user for a level, then adds/updates the PR declaration
- `/pr-declare <level>` — uses the specified level directly

Also use this when the user asks to "declare AI usage on this PR", "add an AI declaration to the MR", or similar.

Works with GitHub (`gh`) and GitLab (`glab`). Detect which one applies from the remote or the URL the user gives.

## Spec Fidelity

The spec evolves. Do **not** rephrase or paraphrase any text taken from the spec — version strings, level names, and level definitions must be reproduced verbatim. Treat the upstream spec as the single source of truth.

## Process

### Step 0: Fetch the current spec

Before prompting, fetch the live spec so the skill stays in sync with upstream:

1. Fetch `https://raw.githubusercontent.com/DimwitLabs/AI-DECLARATION.md/main/package.json` and read the `version` field — the **current spec version**.
2. Fetch `https://raw.githubusercontent.com/DimwitLabs/AI-DECLARATION.md/main/README.md` and extract the level definitions block (the bullet list under the `Levels` heading, beginning with `` - `none`: ``). These are the **verbatim level definitions**.

If either fetch fails (offline, rate-limited), fall back to the frozen snapshot below and tell the user the skill is using the offline fallback.

**Frozen fallback (spec `0.1.2`, 2026-04-14):**

- `none`: Human acts on the task alone with no AI involvement.
- `hint`: Human acts on the task and the AI surfaces suggestions passively.
- `assist`: Human prompts and the AI acts on a part of the task.
- `pair`: Human prompts as both human and AI both act on the task equally; Human understands internals clearly.
- `copilot`: Human prompts and AI acts on the whole task, prompting the Human for permission or clarification.
- `auto`: Human prompts and AI acts autonomously bringing the task to completion.

Use the fetched (or fallback) values for `<version>` and the level definitions in every subsequent step. The levels are ordered from least to most AI involvement in the order the spec lists them.

### Step 1: Identify the PR/MR

Determine which PR to annotate:
- If the user gave a PR/MR URL or number, use it.
- Otherwise resolve the PR for the current branch:
  - GitHub: `gh pr view [<number>] --json number,url,body`
  - GitLab: `glab mr view [<number>] -F json` (read `iid`, `web_url`, and `description`)
- If no PR exists yet, ask whether to create a draft one or wait. Do not push or open a PR without user approval.

Detect the forge from the git remote host (`github.com` → `gh`, a GitLab host → `glab`) or from the URL.

### Step 2: Determine the level

If the user provided a level with the command, validate it against the level names from Step 0. If invalid, tell the user and list valid options.

If **no level was specified**, ask the user to select one, presenting the level bullets **verbatim** as fetched in Step 0:

> Which AI involvement level best describes this PR?
>
> (one bullet per level from Step 0, unchanged)

Wait for the user to respond before proceeding.

### Step 3: Determine the scope

Ask whether to declare **per-process** levels or just a single global level:

> Would you like to declare per-process levels (design, implementation, testing, etc.) or just a single global level?
> 1. **Global only** — One level for the whole PR
> 2. **Per-process** — Different levels for different phases

If per-process, ask about each relevant phase:
- `design` — Architecture, system design, and decision-making
- `implementation` — Writing production code
- `testing` — Writing tests, test plans, and quality assurance
- `documentation` — Writing docs, comments, READMEs, and changelogs
- `review` — Code review and pull request feedback
- `deployment` — CI/CD configuration, infrastructure, and release scripts

The global level shown in the badge must be the **highest** level among declared processes, using the level order from Step 0. Any process not listed is implicitly `none`.

### Step 4: Build the declaration block

Assemble a self-contained markdown block delimited by HTML comment markers so it can be found and updated idempotently:

```markdown
<!-- ai-declaration:start -->
[![AI-DECLARATION: <level>](<badge-url>)](https://ai-declaration.md)

**AI declaration** ([v<version>](https://ai-declaration.md/en/<version>)): `<level>`
<!-- ai-declaration:end -->
```

For per-process declarations, append a list before the end marker:

```markdown
<!-- ai-declaration:start -->
[![AI-DECLARATION: <highest-level>](<badge-url>)](https://ai-declaration.md)

**AI declaration** ([v<version>](https://ai-declaration.md/en/<version>)): `<highest-level>`

- design: `<level>`
- implementation: `<level>`
<!-- ai-declaration:end -->
```

**Badge URLs by level** (use the global/highest level):

| Level | Badge URL |
|-------|-----------|
| `none` | `https://img.shields.io/badge/䷼%20AI--DECLARATION-none-dcfce7?labelColor=dcfce7` |
| `hint` | `https://img.shields.io/badge/䷼%20AI--DECLARATION-hint-ecfccb?labelColor=ecfccb` |
| `assist` | `https://img.shields.io/badge/䷼%20AI--DECLARATION-assist-fef9c3?labelColor=fef9c3` |
| `pair` | `https://img.shields.io/badge/䷼%20AI--DECLARATION-pair-ffedd5?labelColor=ffedd5` |
| `copilot` | `https://img.shields.io/badge/䷼%20AI--DECLARATION-copilot-fee2e2?labelColor=fee2e2` |
| `auto` | `https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe` |

### Step 5: Update the PR description

Take the current body from the Step 1 response (`body` on GitHub, `description` on GitLab), then:
- If a block between `<!-- ai-declaration:start -->` and `<!-- ai-declaration:end -->` already exists, **replace** it in place (keep its position).
- Otherwise, **append** the block at the end of the body (after a blank line).

Never drop or reorder the user's existing description text.

Write the updated body back:
- GitHub: `gh pr edit <number> --body-file <tmpfile>`
- GitLab: `glab mr update <number> --description "$(cat <tmpfile>)"`

Write the body to a temp file first to avoid shell-escaping problems with markdown.

### Step 6: Confirm

Summarize:
- The PR/MR that was updated (number + URL)
- The declared level (and per-process levels, if any)
- That the declaration block was inserted or replaced

## Common Mistakes

- **Hardcoding a stale version**: Always use the `<version>` fetched in Step 0.
- **Clobbering the PR body**: Read the existing description first; replace only the marked block, never the whole body.
- **Duplicate blocks**: If markers already exist, replace in place instead of appending a second block.
- **Global level lower than process levels**: The badge level must be the maximum of all declared process levels.
- **Invalid level names**: Only the level names returned by Step 0 are valid.
- **Paraphrasing the spec**: Level descriptions presented to the user must be verbatim from the upstream README.
- **Opening/pushing a PR without approval**: If no PR exists, ask first; do not create or push unprompted.
- **Wrong forge tool**: Match `gh`/`glab` to the actual remote host.
- **Mentioning a username**: Never include a username in the declaration.

## Reference

- Spec homepage: https://ai-declaration.md
- Spec repo: https://github.com/DimwitLabs/AI-DECLARATION.md
- Spec version source (fetched at runtime): https://raw.githubusercontent.com/DimwitLabs/AI-DECLARATION.md/main/package.json
- Spec level definitions source (fetched at runtime): https://raw.githubusercontent.com/DimwitLabs/AI-DECLARATION.md/main/README.md
- Frozen fallback version: `0.1.2`
