import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkitx-x3/core'
import type { ProviderOffer, ProviderRequest } from '@modkitx-x3/sdk'
import { buildLockEntry, resolveProvider, serializePolicyLock } from '@modkitx-x3/host'

const plain: ProviderOffer = {
  kind: 'primary',
  extensionId: 'org.x3lab/greeters',
  extensionVersion: '1.0.0',
  providerId: 'org.x3lab/greeter-plain',
  runtimeVariant: 'portable',
  target: { environments: ['node', 'node-worker'] },
  provides: [{ contract: 'x3.demo/greeter', version: '1.2.0' }],
  outputs: ['demo.plain'],
  operations: ['demo.greet'],
}

const fancy: ProviderOffer = {
  kind: 'primary',
  extensionId: 'org.x3lab/greeters',
  extensionVersion: '1.0.0',
  providerId: 'org.x3lab/greeter-fancy',
  runtimeVariant: 'portable',
  target: { environments: ['node'] },
  provides: [{ contract: 'x3.demo/greeter', version: '1.4.0' }],
  outputs: ['demo.plain', 'demo.fancy'],
  operations: ['demo.greet'],
}

const request: ProviderRequest = {
  contract: { contract: 'x3.demo/greeter', major: 1 },
  target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
}

describe('staged resolver v1 (23 §9; S3 acceptance)', () => {
  it('selects deterministically by preference and is shuffle-stable byte-for-byte', () => {
    const preferFancy: ProviderRequest = { ...request, preferredOutputs: ['demo.fancy'] }
    const forward = resolveProvider(preferFancy, [plain, fancy])
    const shuffled = resolveProvider(preferFancy, [fancy, plain])
    expect(canonicalJsonStringify(shuffled)).toBe(canonicalJsonStringify(forward))
    expect(forward.state).toBe('resolved')
    if (forward.state === 'resolved') {
      expect(forward.selected.offer.providerId).toBe('org.x3lab/greeter-fancy')
      expect(forward.alternatives.map(a => a.offer.providerId)).toEqual(['org.x3lab/greeter-plain'])
    }
  })

  it('returns ambiguous on an unresolvable tie — never discovery order', () => {
    const tied = resolveProvider(request, [plain, fancy])
    expect(tied.state).toBe('unresolved')
    if (tied.state === 'unresolved') {
      expect(tied.reason).toBe('ambiguous')
      expect(tied.rejected.filter(r => r.reason === 'ambiguous')).toHaveLength(2)
    }
    const reversed = resolveProvider(request, [fancy, plain])
    expect(canonicalJsonStringify(reversed)).toBe(canonicalJsonStringify(tied))
  })

  it('gives every incompatible candidate a reason code', () => {
    const rangeReq: ProviderRequest = {
      ...request,
      contract: { contract: 'x3.demo/greeter', major: 1, range: '^1.3' },
    }
    const ranged = resolveProvider(rangeReq, [plain, fancy])
    expect(ranged.state).toBe('resolved')
    if (ranged.state === 'resolved') {
      expect(ranged.selected.offer.providerId).toBe('org.x3lab/greeter-fancy')
      expect(ranged.rejected).toContainEqual(
        expect.objectContaining({
          providerId: 'org.x3lab/greeter-plain',
          reason: 'version-incompatible',
        }),
      )
    }

    const workerReq: ProviderRequest = {
      ...request,
      target: { ...request.target, environment: 'node-worker' },
      preferredOutputs: ['demo.fancy'],
    }
    const workerRes = resolveProvider(workerReq, [plain, fancy])
    expect(workerRes.state).toBe('resolved')
    if (workerRes.state === 'resolved') {
      expect(workerRes.selected.offer.providerId).toBe('org.x3lab/greeter-plain')
      expect(workerRes.rejected).toContainEqual(
        expect.objectContaining({
          providerId: 'org.x3lab/greeter-fancy',
          reason: 'target-incompatible',
        }),
      )
    }

    const needsNetwork: ProviderOffer = {
      ...fancy,
      providerId: 'org.x3lab/greeter-net',
      requiredPermissions: ['network'],
    }
    const permRes = resolveProvider({ ...request, preferredOutputs: ['demo.fancy'] }, [
      plain,
      needsNetwork,
    ])
    expect(permRes.state).toBe('resolved')
    if (permRes.state === 'resolved') {
      expect(permRes.rejected).toContainEqual(
        expect.objectContaining({
          providerId: 'org.x3lab/greeter-net',
          reason: 'permission-required',
        }),
      )
    }

    const outputReq: ProviderRequest = { ...request, requiredOutputs: ['demo.fancy'] }
    const outputRes = resolveProvider(outputReq, [plain, fancy])
    expect(outputRes.state).toBe('resolved')
    if (outputRes.state === 'resolved') {
      expect(outputRes.selected.offer.providerId).toBe('org.x3lab/greeter-fancy')
      expect(outputRes.rejected).toContainEqual(
        expect.objectContaining({
          providerId: 'org.x3lab/greeter-plain',
          reason: 'output-missing',
        }),
      )
    }

    const augmentation: ProviderOffer = {
      ...fancy,
      providerId: 'org.x3lab/greeter-aug',
      kind: 'augmentation',
    }
    const augRes = resolveProvider({ ...request, preferredOutputs: ['demo.fancy'] }, [
      plain,
      fancy,
      augmentation,
    ])
    expect(augRes.state).toBe('resolved')
    if (augRes.state === 'resolved') {
      expect(augRes.rejected).toContainEqual(
        expect.objectContaining({
          providerId: 'org.x3lab/greeter-aug',
          reason: 'unsupported-kind',
        }),
      )
    }
  })

  it('honors an exact pin and reports pin-unsatisfied', () => {
    const pinned = resolveProvider({ ...request, pin: { providerId: 'org.x3lab/greeter-plain' } }, [
      plain,
      fancy,
    ])
    expect(pinned.state).toBe('resolved')
    if (pinned.state === 'resolved') {
      expect(pinned.selected.offer.providerId).toBe('org.x3lab/greeter-plain')
    }
    const missing = resolveProvider({ ...request, pin: { providerId: 'org.x3lab/absent' } }, [
      plain,
      fancy,
    ])
    expect(missing.state).toBe('unresolved')
    if (missing.state === 'unresolved') expect(missing.reason).toBe('pin-unsatisfied')
  })

  it('emits a byte-stable canonical policy lock (23 §11)', () => {
    const preferFancy: ProviderRequest = {
      ...request,
      preferredOutputs: ['demo.fancy', 'demo.fancy', 'demo.plain'],
      workload: 'interactive',
    }
    const result = resolveProvider(preferFancy, [plain, fancy])
    const otherOrder = resolveProvider(
      { ...preferFancy, preferredOutputs: ['demo.plain', 'demo.fancy'] },
      [fancy, plain],
    )
    const lockA = serializePolicyLock([buildLockEntry(preferFancy, result)])
    const lockB = serializePolicyLock([buildLockEntry(preferFancy, otherOrder)])
    expect(lockA).toBe(lockB)
    const entry = buildLockEntry(preferFancy, result)
    expect(entry.key.normalizedRange).toBe('*')
    expect(entry.key.preferredOutputs).toEqual(['demo.fancy', 'demo.plain']) // unique + sorted
    expect(entry.primary).toEqual({
      extension: 'org.x3lab/greeters',
      contributionId: 'org.x3lab/greeter-fancy',
      contractMajor: 1,
    })
    // The portable lock never carries OS/arch/variant/artifact/grant facts (23 §11).
    expect(lockA).not.toContain('windows')
    expect(lockA).not.toContain('x64')
    expect(lockA).not.toContain('portable')
  })
})
