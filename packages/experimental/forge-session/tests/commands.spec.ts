import { describe, expect, it } from 'vitest'
import { changeRequestUrls, commandKind, commandOf, pushedBranches, sameChangeRequestUrl } from '../src/commands.ts'

describe('commandOf', () => {
  it('reads the string command argument', () => {
    expect(commandOf('{"command":"git push","description":"push"}')).toBe('git push')
  })

  it.each([
    ['malformed JSON', '{"command":'],
    ['a JSON string', '"git push"'],
    ['JSON null', 'null'],
    ['a missing command', '{"cmd":"git push"}'],
    ['a non-string command', '{"command":["git","push"]}'],
  ])('returns undefined for %s', (_label, raw) => {
    expect(commandOf(raw)).toBeUndefined()
  })
})

describe('commandKind', () => {
  it.each([
    ['gh pr create --fill', 'create'],
    ['gh pr new -t title -b body', 'create'],
    ['git push', 'push'],
    ['git push -u origin HEAD', 'push'],
    ['git -C ../checkout push origin feat', 'push'],
    ['git -c credential.helper= push', 'push'],
    ['git --no-pager push --force-with-lease', 'push'],
    ['cd repo && git push && gh pr create --fill', 'both'],
  ])('classifies %j as %s', (command, kind) => {
    expect(commandKind(command)).toBe(kind)
  })

  it.each([
    'git commit -m "push the fix"',
    'git stash push -m wip',
    'gh pr view 12',
    'gh pr list --head feat',
    'git-push origin',
  ])('ignores %j', (command) => {
    expect(commandKind(command)).toBeUndefined()
  })
})

describe('changeRequestUrls', () => {
  it('finds distinct pull request URLs in order', () => {
    const text = [
      'https://github.com/octo/demo/pull/12',
      'see (https://github.com/octo/demo/pull/3/files) and https://github.com/octo/demo/pull/12',
      '[link](http://ghe.corp.example/team/svc/pull/7)',
    ].join('\n')

    expect(changeRequestUrls(text)).toEqual([
      'https://github.com/octo/demo/pull/12',
      'https://github.com/octo/demo/pull/3',
      'http://ghe.corp.example/team/svc/pull/7',
    ])
  })

  it('ignores compare links and malformed numbers', () => {
    expect(changeRequestUrls('https://github.com/octo/demo/pull/new/feat https://github.com/octo/demo/pull/12abc')).toEqual([])
  })
})

describe('pushedBranches', () => {
  it('reads created, updated, forced, and current branches under their remote', () => {
    const text = [
      'To github.com:octo/demo.git',
      ' * [new branch]      feat -> feat',
      '   1a2b3c4..5d6e7f8  main -> main',
      ' + 1a2b3c4...5d6e7f8 topic -> topic (forced update)',
      ' = [up to date]      stable -> stable',
      ' * [new branch]      HEAD -> refs/heads/review',
    ].join('\n')

    expect(pushedBranches(text)).toEqual([
      { remote: 'github.com:octo/demo.git', branch: 'feat' },
      { remote: 'github.com:octo/demo.git', branch: 'main' },
      { remote: 'github.com:octo/demo.git', branch: 'topic' },
      { remote: 'github.com:octo/demo.git', branch: 'stable' },
      { remote: 'github.com:octo/demo.git', branch: 'review' },
    ])
  })

  it('excludes rejected, deleted, tag, and non-branch refs', () => {
    const text = [
      'To https://github.com/octo/demo.git',
      ' ! [rejected]        feat -> feat (fetch first)',
      ' ! [remote rejected] main -> main (protected branch hook declined)',
      ' - [deleted]         old',
      ' * [new tag]         v1.0 -> v1.0',
      ' * [new reference]   HEAD -> refs/for/main',
      'error: failed to push some refs to \'https://github.com/octo/demo.git\'',
    ].join('\n')

    expect(pushedBranches(text)).toEqual([])
  })

  it('assigns each ref line to the nearest preceding remote and ignores ref lines before any remote', () => {
    const text = [
      ' * [new branch]      orphan -> orphan',
      'To fake.test:octo/one.git\r',
      ' * [new branch]      feat -> feat\r',
      'To fake.test:octo/two.git',
      ' * [new branch]      feat -> feat',
      ' * [new branch]      feat -> feat',
    ].join('\n')

    expect(pushedBranches(text)).toEqual([
      { remote: 'fake.test:octo/one.git', branch: 'feat' },
      { remote: 'fake.test:octo/two.git', branch: 'feat' },
    ])
  })
})

describe('sameChangeRequestUrl', () => {
  it('ignores scheme, letter case, query, fragment, and trailing slashes', () => {
    expect(sameChangeRequestUrl('https://github.com/Octo/Demo/pull/1/', 'http://github.com/octo/demo/pull/1?tab=checks#top')).toBe(true)
  })

  it('distinguishes different numbers and repositories', () => {
    expect(sameChangeRequestUrl('https://github.com/octo/demo/pull/1', 'https://github.com/octo/demo/pull/10')).toBe(false)
    expect(sameChangeRequestUrl('https://github.com/octo/demo/pull/1', 'https://github.com/octo/other/pull/1')).toBe(false)
  })
})
