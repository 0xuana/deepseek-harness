/** The package's public entry points re-export the one shared contract. */

import { expect, it } from 'vitest'
import * as identity from '@deepseek-ai/dsh-experimental-liveshare-protocol/identity'
import * as protocol from '@deepseek-ai/dsh-experimental-liveshare-protocol/protocol'
import * as root from '@deepseek-ai/dsh-experimental-liveshare-protocol'

it('publishes the mock identity provider only on its test-scoped entry', async () => {
  const mock = await import('@deepseek-ai/dsh-experimental-liveshare-protocol/identity/mock')
  expect(mock.MockIdentityProvider).toBeTypeOf('function')
  expect('MockIdentityProvider' in root).toBe(false)
})

it('re-exports the protocol and identity contracts from the package root', () => {
  expect(root.LIVESHARE_PROTOCOL_VERSION).toBe(protocol.LIVESHARE_PROTOCOL_VERSION)
  expect(root.parseShareAccessState).toBe(protocol.parseShareAccessState)
  expect(root.identityKeyOf).toBe(identity.identityKeyOf)
  expect('MockIdentityProvider' in identity).toBe(false)
  expect(root.viewerCarrierScript).toBeTypeOf('function')
})

it('re-exports the identity contract from its own entry', () => {
  expect(identity.identityKeyOf({ providerId: 'p', tenantId: 't', subjectId: 's' })).toBe('p:t:s')
  expect(identity.identityFromKey('p:t:s')).toEqual({ providerId: 'p', tenantId: 't', subjectId: 's' })
  expect(identity.identityFromKey('p:t')).toBeUndefined()
  expect(identity.identityFromKey('p::s')).toBeUndefined()
})
