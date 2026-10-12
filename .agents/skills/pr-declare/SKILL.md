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

Works with GitHub (`gh`) and GitLab (`glab`).

## Spec Fidelity

The spec evolves. Do **not** rephrase or paraphrase any text taken from the spec — version strings, level names, level definitions, process names, and badge URLs must be reproduced verbatim. Treat the upstream spec as the single source of truth.

## Process

### Step 0: Fetch the current spec

Before prompting, fetch the live spec so the skill stays in sync with upstream:

1. Fetch `https://raw.githubusercontent.com/DimwitLabs/AI-DECLARATION.md/main/package.json` and read the `version` field — the **current spec version**.
2. Fetch `https://raw.githubusercontent.com/DimwitLabs/AI-DECLARATION.md/main/README.md` and extract three bullet lists verbatim: the **level definitions** under the `Levels` heading, the **process definitions** under the `Processes` heading, and the **badge** for each level under the `Badges` heading. Match each heading by its text at any heading depth.

Use the fetched values only when `version` matches `^\d+\.\d+\.\d+$`, the level and process lists are non-empty, and every level has a badge. If a fetch fails (offline, rate-limited) or this check fails, use the frozen fallback below and tell the user the skill is using it.

**Frozen fallback (spec `0.1.2`):**

Levels:

- `none`: Human acts on the task alone with no AI involvement.
- `hint`: Human acts on the task and the AI surfaces suggestions passively.
- `assist`: Human prompts and the AI acts on a part of the task.
- `pair`: Human prompts as both human and AI both act on the task equally; Human understands internals clearly.
- `copilot`: Human prompts and AI acts on the whole task, prompting the Human for permission or clarification.
- `auto`: Human prompts and AI acts autonomously bringing the task to completion.

Processes:

- `design`: Architecture, system design, and decision-making.
- `implementation`: Writing production code.
- `testing`: Writing tests, test plans, and quality assurance.
- `documentation`: Writing docs, comments, READMEs, and changelogs.
- `review`: Code review and pull request feedback.
- `deployment`: CI/CD configuration, infrastructure, and release scripts.

Badges:

- [![AI-DECLARATION: none](https://img.shields.io/badge/䷼%20AI--DECLARATION-none-dcfce7?labelColor=dcfce7)](https://ai-declaration.md)
- [![AI-DECLARATION: hint](https://img.shields.io/badge/䷼%20AI--DECLARATION-hint-ecfccb?labelColor=ecfccb)](https://ai-declaration.md)
- [![AI-DECLARATION: assist](https://img.shields.io/badge/䷼%20AI--DECLARATION-assist-fef9c3?labelColor=fef9c3)](https://ai-declaration.md)
- [![AI-DECLARATION: pair](https://img.shields.io/badge/䷼%20AI--DECLARATION-pair-ffedd5?labelColor=ffedd5)](https://ai-declaration.md)
- [![AI-DECLARATION: copilot](https://img.shields.io/badge/䷼%20AI--DECLARATION-copilot-fee2e2?labelColor=fee2e2)](https://ai-declaration.md)
- [![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](https://ai-declaration.md)

Use the fetched (or fallback) values in every subsequent step. The levels are ordered from least to most AI involvement in the order the spec lists them.

### Step 1: Identify the PR/MR

Determine which PR to annotate: the PR/MR URL or number the user gave, otherwise the PR/MR for the current branch. If no PR exists yet, ask whether to create a draft one or wait. Do not push or open a PR without user approval.

Detect the forge from the URL or the git remote host (`github.com` → `gh`, a GitLab host → `glab`). Record the PR/MR **target**: the full URL on GitHub, or the MR number plus `-R <MR URL>` on GitLab, so a URL from another repository never resolves against the current checkout. For the current branch, read the URL from `gh pr view --json url` or `web_url` from `glab mr view -F json`.

### Step 2: Determine the level

If the user provided a level with the command, validate it against the level names from Step 0. If invalid, tell the user and list valid options. A valid level is the single global level: skip Step 3.

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

If per-process, ask for a level for every process from Step 0.

The global level shown in the badge must be the **highest** level among declared processes, using the level order from Step 0. Any process not listed is implicitly `none`.

### Step 4: Build the declaration block

Assemble a self-contained markdown block delimited by HTML comment markers so it can be found and updated idempotently:

```markdown
<!-- ai-declaration:start -->
<badge for <level>>

**AI declaration** ([v<version>](https://ai-declaration.md/en/<version>)): `<level>`
<!-- ai-declaration:end -->
```

For per-process declarations, append a list before the end marker:

```markdown
<!-- ai-declaration:start -->
<badge for <highest-level>>

**AI declaration** ([v<version>](https://ai-declaration.md/en/<version>)): `<highest-level>`

- design: `<level>`
- implementation: `<level>`
<!-- ai-declaration:end -->
```

Replace `<badge for …>` with the Step 0 badge for the global (highest) level, without the leading `- `.

### Step 5: Update the PR description

After all user interaction is complete, fetch the current body so edits made while waiting are kept:
- GitHub: `gh pr view <target> --json number,url,body` (read `body`)
- GitLab: `glab mr view <target> -F json` (read `iid`, `web_url`, and `description`)

Then:
- If a block between `<!-- ai-declaration:start -->` and `<!-- ai-declaration:end -->` already exists, **replace** it in place (keep its position).
- Otherwise, **append** the block at the end of the body (after a blank line).

Never drop or reorder the user's existing description text.

Write the updated body back:
- GitHub: `gh pr edit <target> --body-file <tmpfile>`
- GitLab: `glab mr update <target> --description "$(cat <tmpfile>)"`

Write the body to a temp file first so the markdown is never shell-escaped; `gh` reads the file and `glab` receives its contents through `$(cat …)`.

### Step 6: Confirm

Summarize:
- The PR/MR that was updated (number + URL)
- The declared level (and per-process levels, if any)
- That the declaration block was inserted or replaced

## Common Mistakes

- **Mentioning a username**: Never include a username in the declaration.
