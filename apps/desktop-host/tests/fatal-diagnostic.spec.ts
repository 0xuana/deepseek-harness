import { expect, it } from 'vitest'
import { StartupError } from '@deepseek-ai/dsh-app-boot'
import { formatFatalDiagnostic, MAX_FATAL_DIAGNOSTIC_CHARS } from '../src/fatal-diagnostic.ts'

it('includes non-enumerable startup entries without copying arbitrary startup logger arguments', () => {
  const error = new StartupError('required plugin did not activate', [{
    id: 'agent-loop', module: '@deepseek-ai/dsh-agent-loop', required: true, fiberState: undefined,
    outcome: { kind: 'pending', missing: ['agents', 'sessions'] },
  }])
  error.startup = { configurationPath: '/profile/cordis.yml', messages: [{
    ts: 1, name: 'plugin', type: 'warn', args: ['private-plugin-output'],
  }] }
  const report = formatFatalDiagnostic(new Error('Host startup failed', { cause: error }))
  expect(report).toContain('--- startup entries ---')
  expect(report).toContain('@deepseek-ai/dsh-agent-loop')
  expect(report).toContain("missing: [ 'agents', 'sessions' ]")
  expect(report).toContain('Configuration file: /profile/cordis.yml')
  expect(report).not.toContain('private-plugin-output')
})

it('marks truncation within the complete IPC budget and preserves Unicode', () => {
  const error = new Error('😀'.repeat(MAX_FATAL_DIAGNOSTIC_CHARS))
  const report = formatFatalDiagnostic(error)
  expect(report.length).toBeLessThanOrEqual(MAX_FATAL_DIAGNOSTIC_CHARS)
  expect(report).toContain('Host diagnostic truncated')
  expect(report.isWellFormed()).toBe(true)
})

it('keeps missing-service evidence ahead of a truncated plugin inventory', () => {
  const error = new StartupError('failure '.repeat(2000), [])
  error.composition = {
    services: [{ consumer: 'agent-loop', service: 'agents', providers: [] }],
    plugins: Array.from({ length: 256 }, (_, index) => ({
      id: `plugin-${index}`, module: 'long-package-name'.repeat(30), version: '1.0.0',
      state: 'disabled', source: '/profile/cordis.yml', missing: [],
    })),
    omittedPlugins: 3, omittedServices: 2,
  }
  const report = formatFatalDiagnostic(error)
  expect(report).toContain('original error truncated')
  expect(report).toContain('"service":"agents","providers":[]')
  expect(report).toContain('Omitted plugin rows: 3; omitted missing-service observations: 2.')
  expect(report).toContain('"source":"/profile/cordis.yml"')
  expect(report).toContain('Host diagnostic truncated')
  expect(report.length).toBeLessThanOrEqual(MAX_FATAL_DIAGNOSTIC_CHARS)
})

it('terminates traversal through cyclic and aggregate causes', () => {
  const error = new AggregateError([], 'cycle')
  error.errors.push(error)
  error.cause = error
  expect(formatFatalDiagnostic(error)).toContain('cycle')
})
