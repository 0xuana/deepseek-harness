import { describe, expect, it } from 'vitest'
import {
  IDENTITY_TENANT_PLACEHOLDER,
  identityFromKey,
  identityKeyOf,
  normalizeIdentity,
  requireIdentityTenant,
  type IdentityActor,
} from '@deepseek-ai/dsh-experimental-liveshare-protocol/identity'

const actor: IdentityActor = {
  providerId: 'feishu',
  tenantId: 'tenant/a',
  subjectId: 'user:one',
  displayName: 'Alice',
}

describe('identity keys', () => {
  it('derives one stable, encoded identity key from the provider triple', () => {
    expect(identityKeyOf(actor)).toBe('feishu:tenant%2Fa:user%3Aone')
    expect(identityKeyOf(actor)).toBe(identityKeyOf({
      providerId: actor.providerId,
      tenantId: actor.tenantId,
      subjectId: actor.subjectId,
    }))
    expect(identityFromKey(identityKeyOf(actor))).toEqual({
      providerId: actor.providerId,
      tenantId: actor.tenantId,
      subjectId: actor.subjectId,
    })
    expect(identityFromKey('feishu:only-two')).toBeUndefined()
    expect(identityFromKey('feishu:%E0%A4%A:user')).toBeUndefined()
  })

  it('fills the placeholder tenant only for a provider that issues none', () => {
    expect(normalizeIdentity({ providerId: 'deepseek', tenantId: '', subjectId: 'user' }))
      .toEqual({ providerId: 'deepseek', tenantId: IDENTITY_TENANT_PLACEHOLDER, subjectId: 'user' })
    expect(normalizeIdentity({ providerId: 'deepseek', tenantId: 'tenant-a', subjectId: 'user' }))
      .toEqual({ providerId: 'deepseek', tenantId: 'tenant-a', subjectId: 'user' })
    expect(normalizeIdentity({ providerId: '', tenantId: '', subjectId: 'user' })).toBeUndefined()
    expect(normalizeIdentity({ providerId: 'deepseek', tenantId: '', subjectId: '' })).toBeUndefined()
    expect(normalizeIdentity({ providerId: 'deepseek', tenantId: '', subjectId: 'user' }, ''))
      .toBeUndefined()
    expect(normalizeIdentity({ providerId: 'deepseek', tenantId: '', subjectId: 'user' }, 'tenant-b'))
      .toEqual({ providerId: 'deepseek', tenantId: 'tenant-b', subjectId: 'user' })
  })

  it('rejects any triple whose provider must issue a tenant but left it empty', () => {
    expect(requireIdentityTenant({ providerId: 'feishu', tenantId: 'tenant-a', subjectId: 'user' }))
      .toEqual({ providerId: 'feishu', tenantId: 'tenant-a', subjectId: 'user' })
    expect(requireIdentityTenant({ providerId: 'feishu', tenantId: '', subjectId: 'user' })).toBeUndefined()
    expect(requireIdentityTenant({ providerId: '', tenantId: 'tenant-a', subjectId: 'user' })).toBeUndefined()
    expect(requireIdentityTenant({ providerId: 'feishu', tenantId: 'tenant-a', subjectId: '' })).toBeUndefined()
  })
})
