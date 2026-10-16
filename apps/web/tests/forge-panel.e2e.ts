/** Worktree Sessions and the change request panel through the real optional bundle, a Git checkout, and a scripted GitHub CLI. */
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type {} from '@deepseek-ai/dsh-experimental-forge-session'
import { pluginRecordOf, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, readPersistedEvents, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, writeComposerDraft, ZH_BROWSER_LOCALE } from './support.ts'

const BUNDLE = fileURLToPath(new URL('../../../packages/experimental/forge-bundle', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v4.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/forge-panel', import.meta.url))
const MODE = webSnapshotMode()
const PULL = 'https://github.com/octo/demo/pull/7'
/** Message sent after the worktree is removed, which the composer keeps. */
const FOLLOW_UP = 'Summarize the failed check'
const run = promisify(execFile)

/**
 * GitHub CLI double: signed in to github.com; GraphQL serves pull request 7 of
 * octo/demo with one failed and one passed check run, one unresolved thread,
 * and a required review. Every invocation is appended to `calls.jsonl`.
 */
const GH = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2)
appendFileSync(join(dirname(fileURLToPath(import.meta.url)), 'calls.jsonl'), JSON.stringify(args) + '\\n')
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write('github.com\\n  Logged in to github.com account octo\\n')
  process.exit(0)
}
if (args[0] === 'api' && args[1] === 'graphql') {
  const query = args.find(arg => arg.startsWith('query=')).slice('query='.length)
  const check = (name, conclusion, completedAt) => ({
    __typename: 'CheckRun', name, status: 'COMPLETED', conclusion,
    detailsUrl: 'https://github.com/octo/demo/actions/runs/1', startedAt: '2026-10-09T00:00:00Z', completedAt,
    checkSuite: { workflowRun: { workflow: { name: 'CI' } } },
  })
  const pull = number => number !== 7 ? null : {
    number, url: 'https://github.com/octo/demo/pull/7', title: 'Add the pull request panel', state: 'OPEN', isDraft: false,
    updatedAt: '2026-10-09T00:00:00Z', closedAt: null, author: { login: 'octo' }, headRefName: 'feat', headRefOid: 'a'.repeat(40),
    baseRefName: 'main', additions: 128, deletions: 14, mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED',
    reviewThreads: { nodes: [{ isResolved: false }] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: {
      pageInfo: { hasNextPage: false },
      nodes: [check('lint', 'SUCCESS', '2026-10-09T00:00:42Z'), check('test', 'FAILURE', '2026-10-09T00:02:07Z')],
    } } } }] },
  }
  const data = {}
  let repository
  for (const match of query.matchAll(/(r\\d+): repository\\(|(p\\d+): pullRequest\\(number: (\\d+)\\)/g)) {
    if (match[1] !== undefined) data[repository = match[1]] = {}
    else data[repository][match[2]] = pull(Number(match[3]))
  }
  process.stdout.write(JSON.stringify({ data }))
  process.exit(0)
}
process.stderr.write('unexpected gh invocation\\n')
process.exit(1)
`

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } })
  return stdout.trim()
}

/** A Web scaffold with the bundle, a GitHub checkout of `main` and `release`, and a fresh Session whose worktree option chose `release`. */
interface ReleaseRequest {
  readonly scaffold: WebScaffold
  readonly page: Page
  /** Temporary directory of the GitHub CLI double and its call log. */
  readonly root: string
  /** The Session's workspace, a main checkout. */
  readonly project: string
  readonly tripwire: ReturnType<typeof watchConsole>
}

/**
 * Launch the bundle against a GitHub checkout of `main` and `release`, open a fresh Session, and choose the worktree option from `release`.
 * @param failureShot - name of the screenshot saved when the test fails.
 * @returns the scaffold, page, and checkout.
 */
async function requestReleaseWorktree(failureShot: string): Promise<ReleaseRequest> {
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  const root = await mkdtemp(join(tmpdir(), 'dsh-forge-panel-'))
  onTestFinished(async () => {
    const failures: unknown[] = []
    await resources.browser?.close().catch((error: unknown) => failures.push(error))
    await resources.scaffold?.close().catch((error: unknown) => failures.push(error))
    await rm(root, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'Forge panel teardown failed')
  })
  const gh = join(root, 'gh')
  await writeFile(gh, GH)
  await chmod(gh, 0o755)
  const overlay = join(root, 'forge.patch.yml')
  await writeFile(overlay, `- id: forge-github\n  config: ${JSON.stringify({ ghCommand: gh })}\n`)
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: BUNDLE, enabled: true }] },
    extraOverlayPath: overlay,
    replayFixture: FIXTURE,
    // The worktree notice, worktree records, and bindings are asserted separately from the borrowed conversation.
    compareReplaySession: false,
  })
  resources.scaffold = scaffold

  const project = join(scaffold.workspaceCwd, 'workspace')
  await mkdir(project, { recursive: true })
  await git(project, 'init', '--quiet', '--initial-branch=main')
  await git(project, 'config', 'user.name', 'Forge Panel')
  await git(project, 'config', 'user.email', 'forge-panel@example.test')
  await git(project, 'config', 'commit.gpgsign', 'false')
  await writeFile(join(project, 'README.md'), 'demo\n')
  await git(project, 'add', 'README.md')
  await git(project, 'commit', '--quiet', '-m', 'init')
  await git(project, 'remote', 'add', 'origin', 'https://github.com/octo/demo.git')
  await git(project, 'branch', 'release')
  await git(project, 'commit', '--quiet', '--allow-empty', '-m', 'main only')

  const browser = await chromium.launch()
  resources.browser = browser
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE, timezoneId: 'Asia/Shanghai' })
  const tripwire = watchConsole(page)
  onTestFailed(async () => { await saveFailureShot(page, failureShot) })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)

  const option = page.locator('[data-forge-worktree]')
  await option.waitFor({ timeout: 20_000 })
  await option.getByRole('checkbox', { name: '工作树', exact: true }).check()
  await option.getByRole('button', { name: '基于 main', exact: true }).click()
  await page.getByRole('menuitem', { name: 'release', exact: true }).click()
  await option.getByRole('button', { name: '基于 release', exact: true }).waitFor()
  return { scaffold, page, root, project, tripwire }
}

/**
 * Send the first prompt of the borrowed scenario.
 * @returns the prompt and the turn's settlement, which resolves to the Session id.
 */
async function sendPrompt(page: Page, scaffold: WebScaffold): Promise<{ readonly prompt: string; readonly settled: Promise<SessionId> }> {
  const [prompt] = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))
  if (prompt === undefined) throw new Error('The borrowed scenario requires a user prompt')
  const settled = scaffold.whenTurnSettled()
  const composer = page.locator('[data-composer-input]').first()
  await writeComposerDraft(page, composer, prompt)
  await composer.press('Enter')
  return { prompt, settled }
}

function worktreeRecords(events: readonly SessionEvent[]): unknown[] {
  return events.flatMap((event) => {
    const record = pluginRecordOf(event)
    return record?.type === 'plugin:client-ui-forge/worktree' ? [record.data] : []
  })
}

it.skipIf(MODE === 'record')('starts a Session in a worktree before its first message, follows its change request, and restores the removed worktree', async () => {
  const { scaffold, page, root, project, tripwire } = await requestReleaseWorktree('web-e2e-forge-panel')
  const { settled } = await sendPrompt(page, scaffold)
  const sessionId = await settled
  await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
  await page.locator('[data-forge-creation]').waitFor({ state: 'detached' })
  await page.locator('[data-forge-worktree]').waitFor({ state: 'detached' })

  const session = scaffold.ctx.sessions.get(sessionId)
  if (session === undefined) throw new Error('The worktree Session must stay loaded')
  const directory = scaffold.ctx.workingDirectory.get(session)
  const branch = basename(directory)
  expect(directory).toBe(join(project, '.agents', 'worktrees', branch))
  expect(branch).toMatch(new RegExp(`^dsh-${sessionId.slice('session-'.length, 'session-'.length + 8)}-[0-9a-f]{4}$`))
  expect(await git(directory, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(branch)
  const baseCommit = await git(project, 'rev-parse', 'release')
  expect(await git(directory, 'rev-parse', 'HEAD')).toBe(baseCommit)
  const events = await readPersistedEvents(scaffold, sessionId)
  expect(worktreeRecords(events)).toEqual([
    { action: 'request', from: 'main' },
    { action: 'request', from: 'release' },
    { action: 'created', worktree: { path: directory, branch, from: 'release', baseCommit, repositoryRoot: project } },
  ])
  // The worktree existed before the turn, so the first model request carried its directory notice.
  const created = events.findIndex((event) => {
    const record = pluginRecordOf(event)
    const data = record?.type === 'plugin:client-ui-forge/worktree' ? record.data : null
    return typeof data === 'object' && data !== null && 'action' in data && data.action === 'created'
  })
  const turn = events.findIndex(event => event.type === 'turn/start')
  const notice = events.findIndex(event => event.type === 'user/message' && event.data.source.kind === 'working-directory')
  expect(created).toBeLessThan(turn)
  expect(notice).toBeGreaterThan(turn)
  expect(notice).toBeLessThan(events.findIndex(event => event.type === 'assistant/message'))

  const label = page.locator('[data-forge-branch]')
  await expect.poll(() => label.textContent(), { timeout: 20_000 }).toBe(branch)
  await label.hover()
  await page.getByRole('tooltip').filter({ hasText: `工作树（基于 release）：${abbreviateHomePath(directory, homedir())}` }).waitFor()
  await page.mouse.move(0, 0)

  // A change request bound the way a `gh pr create` result binds one.
  scaffold.ctx.forgeSession.track(session, PULL)
  const header = page.locator('[data-forge-header]')
  await expect.poll(() => header.getAttribute('aria-label'), { timeout: 20_000 }).toBe('本会话的变更请求需要处理')
  expect(await header.getAttribute('aria-pressed')).toBe('false')
  await header.click()
  await expect.poll(() => header.getAttribute('aria-pressed')).toBe('true')
  const panel = page.locator('[data-forge-panel]')
  const checkout = panel.locator('[data-forge-checkout]')
  await checkout.getByText(branch, { exact: true }).waitFor({ timeout: 20_000 })
  await checkout.getByText('工作树 · 基于 release', { exact: true }).waitFor()
  const change = panel.locator(`[data-forge-change="${PULL}"]`)
  const title = change.getByRole('link', { name: 'Add the pull request panel', exact: true })
  await title.waitFor({ timeout: 20_000 })
  // The only open change request starts expanded.
  await change.getByText('等待评审 · 1 条未解决讨论', { exact: true }).waitFor()
  await compareOrRefreshGolden(join(EXPECTED, 'panel.expected.md'),
    (await captureStableAria(page, '[data-forge-panel]', scaffold.workspaceCwd)).replaceAll(branch, 'dsh-{{worktree}}'), MODE)
  const checksRow = change.getByRole('button', { name: /^检查/ })
  await checksRow.click()
  const checks = page.getByRole('menu')
  await expect.poll(() => checks.getByRole('menuitem').allTextContents()).toEqual([expect.stringMatching(/^test/), expect.stringMatching(/^lint/)])
  await page.keyboard.press('Escape')
  await checks.waitFor({ state: 'detached' })
  expect(await checksRow.getAttribute('aria-expanded')).toBe('false')

  const bindings = async () => (await readPersistedEvents(scaffold, sessionId)).flatMap((event) => {
    const record = pluginRecordOf(event)
    return record?.type === 'plugin:forge-session/binding' ? [record.data] : []
  })
  await change.getByRole('button', { name: '从本会话移除 #7', exact: true }).click()
  await change.waitFor({ state: 'detached' })
  await panel.getByText('本会话还没有变更请求', { exact: true }).waitFor()
  await page.getByRole('alert').filter({ hasText: '已从本会话移除 #7' }).getByRole('button', { name: '撤销', exact: true }).click()
  await title.waitFor({ timeout: 20_000 })
  await expect.poll(bindings).toEqual([{ action: 'track', url: PULL }, { action: 'dismiss', url: PULL }, { action: 'track', url: PULL }])

  const calls = (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
  expect(calls).toContainEqual(['auth', 'status', '--hostname', 'github.com'])
  expect(calls.some(args => args[0] === 'api' && args[1] === 'graphql' && args.includes('--hostname'))).toBe(true)
  await header.click()
  await expect.poll(() => header.getAttribute('aria-pressed')).toBe('false')

  // Removing the worktree outside the Session returns the next message to the composer until the worktree is restored.
  await git(project, 'worktree', 'remove', '--force', directory)
  const composer = page.locator('[data-composer-input]').first()
  await writeComposerDraft(page, composer, FOLLOW_UP)
  const refused = page.waitForResponse('**/api/session/prompt')
  await composer.press('Enter')
  const envelope = await (await refused).json() as { readonly result: unknown }
  expect(envelope.result).toMatchObject({
    ok: false, error: { code: 'session/prompt-rejected', details: { reason: 'forge/worktree-missing', presented: true } },
  })
  const missing = page.locator('[data-forge-missing]')
  await missing.getByText(`可以在原位置恢复分支 ${branch} 的工作树。删除前未提交的修改无法恢复`, { exact: true }).waitFor()
  await expect.poll(() => label.getAttribute('data-missing')).toBe('')
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
  expect(await composer.textContent()).toContain(FOLLOW_UP)
  // The card presents the refusal, so the composer adds no notice of its own.
  expect(await page.getByRole('alert').filter({ hasText: 'was removed' }).count()).toBe(0)
  expect((await readPersistedEvents(scaffold, sessionId)).filter(event => event.type === 'turn/start')).toHaveLength(1)
  await missing.getByRole('button', { name: '恢复工作树', exact: true }).click()
  await missing.waitFor({ state: 'detached', timeout: 20_000 })
  await page.getByRole('alert').filter({ hasText: '工作树已恢复' }).waitFor()
  expect(await git(directory, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(branch)
  expect(await git(directory, 'rev-parse', 'HEAD')).toBe(baseCommit)
  await expect.poll(() => label.getAttribute('data-missing')).toBeNull()
  expect(await composer.textContent()).toContain(FOLLOW_UP)
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})

it.skipIf(MODE === 'record')('returns the first message to the New Session composer when the worktree cannot be created, retries on the next send, and sends it without the worktree', async () => {
  const { scaffold, page, project, tripwire } = await requestReleaseWorktree('web-e2e-forge-panel-failure')
  await git(project, 'branch', '--quiet', '-D', 'release')
  const { prompt, settled } = await sendPrompt(page, scaffold)
  const card = page.locator('[data-forge-creation="failed"]')
  const failure = card.getByRole('region', { name: '创建工作树失败', exact: true })
  await failure.getByText('原因', { exact: true }).waitFor({ timeout: 20_000 })
  const attempted = await failure.getByRole('definition').first().textContent()
  expect(attempted).toMatch(/^dsh-[0-9a-f]{8}-[0-9a-f]{4}$/)
  await failure.getByText('再次发送消息即可重试', { exact: true }).waitFor()
  const option = page.locator('[data-forge-worktree]')
  const checkbox = option.getByRole('checkbox', { name: '工作树', exact: true })
  const composer = page.locator('[data-composer-input]').first()
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
  expect(await composer.textContent()).toBe(prompt)
  expect(await checkbox.isChecked()).toBe(true)
  expect(await checkbox.isDisabled()).toBe(false)
  await option.getByRole('button', { name: '基于 release', exact: true }).waitFor()
  // The card presents the refusal, so the composer adds no notice of its own.
  expect(await page.getByRole('alert').filter({ hasText: 'could not be created' }).count()).toBe(0)

  // Sending again tries again with a new branch name.
  await composer.press('Enter')
  await expect.poll(() => failure.getByRole('definition').first().textContent(), { timeout: 20_000 }).not.toBe(attempted)
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
  expect(await composer.textContent()).toBe(prompt)

  await card.getByRole('button', { name: '不使用工作树', exact: true }).click()
  await card.waitFor({ state: 'detached' })
  await expect.poll(() => checkbox.isChecked()).toBe(false)
  await composer.press('Enter')
  const sessionId = await settled
  await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
  await card.waitFor({ state: 'detached' })

  const session = scaffold.ctx.sessions.get(sessionId)
  if (session === undefined) throw new Error('The Session must stay loaded')
  expect(scaffold.ctx.workingDirectory.get(session)).toBe(project)
  const events = await readPersistedEvents(scaffold, sessionId)
  expect(worktreeRecords(events)).toEqual([{ action: 'request', from: 'main' }, { action: 'request', from: 'release' }, { action: 'cancel' }])
  expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(events.some(event => event.type === 'user/message' && event.data.source.kind === 'working-directory')).toBe(false)
  const label = page.locator('[data-forge-branch]')
  await expect.poll(() => label.textContent(), { timeout: 20_000 }).toBe('main')
  await label.hover()
  await page.getByRole('tooltip').filter({ hasText: `项目目录：${abbreviateHomePath(project, homedir())}` }).waitFor()
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
