import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify, contractId, operationId, traitId } from '@modkit/core'
import type { ProviderOffer, ProviderRequest } from '@modkit/sdk'
import {
  buildLockEntry,
  parsePolicyLock,
  replayPolicyLock,
  resolveProvider,
  serializePolicyLock,
} from '@modkit/host'

const GREETER_CONTRACT = contractId('x3.demo/greeter')
const PLAIN_TRAIT = traitId('demo.plain')
const FANCY_TRAIT = traitId('demo.fancy')
const PLAIN_OUTPUT = { id: PLAIN_TRAIT, definitionVersion: '1.0.0' } as const
const FANCY_OUTPUT = { id: FANCY_TRAIT, definitionVersion: '1.0.0' } as const
const PLAIN_REQUIREMENT = { id: PLAIN_TRAIT, definitionRange: '^1.0' } as const
const FANCY_REQUIREMENT = { id: FANCY_TRAIT, definitionRange: '^1.0' } as const
const GREET_OPERATION = operationId('org.example/demo.greet', {
  contributionId: 'org.example/demo',
})

const plain: ProviderOffer = {
  kind: 'primary',
  extensionId: 'org.x3lab/greeters',
  extensionVersion: '1.0.0',
  providerId: 'org.x3lab/greeter-plain',
  runtimeVariant: 'portable',
  target: { environments: ['node', 'node-worker'] },
  provides: [{ offerId: 'plain', contract: GREETER_CONTRACT, major: 1, version: '1.2.0' }],
  outputs: [PLAIN_OUTPUT],
  operations: [GREET_OPERATION],
}

const fancy: ProviderOffer = {
  kind: 'primary',
  extensionId: 'org.x3lab/greeters',
  extensionVersion: '1.0.0',
  providerId: 'org.x3lab/greeter-fancy',
  runtimeVariant: 'portable',
  target: { environments: ['node'] },
  provides: [{ offerId: 'fancy', contract: GREETER_CONTRACT, major: 1, version: '1.4.0' }],
  outputs: [PLAIN_OUTPUT, FANCY_OUTPUT],
  operations: [GREET_OPERATION],
}

const request: ProviderRequest = {
  contract: { contract: GREETER_CONTRACT, major: 1 },
  target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
}

describe('staged resolver v1 (23 §9; S3 acceptance)', () => {
  it('selects deterministically by preference and is shuffle-stable byte-for-byte', () => {
    const preferFancy: ProviderRequest = { ...request, preferredOutputs: [FANCY_REQUIREMENT] }
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
      contract: { contract: GREETER_CONTRACT, major: 1, range: '^1.3' },
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
      preferredOutputs: [FANCY_REQUIREMENT],
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
    const permRes = resolveProvider({ ...request, preferredOutputs: [FANCY_REQUIREMENT] }, [
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

    const outputReq: ProviderRequest = { ...request, requiredOutputs: [FANCY_REQUIREMENT] }
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
    const augRes = resolveProvider({ ...request, preferredOutputs: [FANCY_REQUIREMENT] }, [
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

  it('matches custom trait outputs by definition range and rejects version misuse', () => {
    const compatible = resolveProvider(
      { ...request, requiredOutputs: [{ ...FANCY_REQUIREMENT }] },
      [{ ...fancy, outputs: [{ ...PLAIN_OUTPUT }, { ...FANCY_OUTPUT }] }],
    )
    expect(compatible.state).toBe('resolved')

    const incompatible = resolveProvider({ ...request, requiredOutputs: [FANCY_REQUIREMENT] }, [
      { ...fancy, outputs: [PLAIN_OUTPUT, { id: FANCY_TRAIT, definitionVersion: '2.0.0' }] },
    ])
    expect(incompatible.state).toBe('unresolved')
    if (incompatible.state === 'unresolved') expect(incompatible.reason).toBe('output-missing')

    const standard = traitId('content.text')
    const versionedStandard = resolveProvider({ ...request, requiredOutputs: [{ id: standard }] }, [
      { ...plain, outputs: [{ id: standard, definitionVersion: '1.0.0' }] },
    ])
    expect(versionedStandard.state).toBe('unresolved')
    if (versionedStandard.state === 'unresolved') {
      expect(versionedStandard.reason).toBe('output-missing')
    }

    const invalidRange = resolveProvider(
      { ...request, requiredOutputs: [{ id: standard, definitionRange: 'garbage' }] },
      [{ ...plain, outputs: [{ id: standard }] }],
    )
    expect(invalidRange.state).toBe('unresolved')
    if (invalidRange.state === 'unresolved') {
      expect(invalidRange.reason).toBe('output-missing')
    }

    const invalidPreference = resolveProvider(
      { ...request, preferredOutputs: [{ id: standard, definitionRange: 'garbage' }] },
      [plain],
    )
    expect(invalidPreference.state).toBe('unresolved')
    if (invalidPreference.state === 'unresolved') {
      expect(invalidPreference.reason).toBe('output-missing')
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

  it('enumerates every logical offer and retains the exact selected offer', () => {
    const multi: ProviderOffer = {
      ...plain,
      providerId: 'org.x3lab/greeter-multi',
      provides: [
        {
          offerId: 'json',
          contract: GREETER_CONTRACT,
          major: 1,
          version: '1.5.0',
          facet: { dialect: 'json', options: { comments: false } },
        },
        {
          offerId: 'jsonc',
          contract: GREETER_CONTRACT,
          major: 1,
          version: '1.5.0',
          facet: { dialect: 'json', options: { comments: true } },
        },
      ],
    }

    const unselected = resolveProvider(request, [multi])
    const reversed = resolveProvider(request, [
      { ...multi, provides: [...multi.provides].reverse() },
    ])
    expect(unselected.state).toBe('unresolved')
    if (unselected.state === 'unresolved') expect(unselected.reason).toBe('ambiguous')
    expect(canonicalJsonStringify(reversed)).toBe(canonicalJsonStringify(unselected))
  })

  it('emits a byte-stable canonical policy lock (23 §11)', () => {
    const preferFancy: ProviderRequest = {
      ...request,
      preferredOutputs: [FANCY_REQUIREMENT, FANCY_REQUIREMENT, PLAIN_REQUIREMENT],
      workload: 'interactive',
    }
    const fancyContract = fancy.provides[0]
    if (fancyContract === undefined) throw new Error('fixture needs one logical offer')
    const facetedFancy: ProviderOffer = {
      ...fancy,
      provides: [{ ...fancyContract, facet: { dialect: 'default' } }],
    }
    const result = resolveProvider(preferFancy, [plain, facetedFancy])
    const otherRequest: ProviderRequest = {
      ...preferFancy,
      preferredOutputs: [PLAIN_REQUIREMENT, FANCY_REQUIREMENT],
    }
    const otherOrder = resolveProvider(otherRequest, [facetedFancy, plain])
    const lockA = serializePolicyLock([buildLockEntry(preferFancy, result)])
    const lockB = serializePolicyLock([buildLockEntry(otherRequest, otherOrder)])
    expect(lockA).toBe(lockB)
    const entry = buildLockEntry(preferFancy, result)
    expect(entry.key.normalizedRange).toBe('*')
    expect(entry.key.preferredOutputs).toEqual([
      { id: FANCY_TRAIT, definitionRange: '>=1.0.0 <2.0.0' },
      { id: PLAIN_TRAIT, definitionRange: '>=1.0.0 <2.0.0' },
    ])
    expect(entry.primary).toEqual({
      extension: 'org.x3lab/greeters',
      contributionId: 'org.x3lab/greeter-fancy',
      contractMajor: 1,
      offerId: 'fancy',
    })
    // The portable lock never carries OS/arch/variant/artifact/grant facts (23 §11).
    expect(lockA).not.toContain('windows')
    expect(lockA).not.toContain('x64')
    expect(lockA).not.toContain('portable')

    expect(parsePolicyLock(lockA).entries).toHaveLength(1)
    const replayed = replayPolicyLock(otherRequest, [plain, facetedFancy], lockA)
    expect(replayed.state).toBe('resolved')
    if (replayed.state === 'resolved') {
      expect(replayed.selected.offer.providerId).toBe('org.x3lab/greeter-fancy')
      expect(replayed.selected.resolvedContract.offerId).toBe('fancy')
    }
  })

  it('strict lock read rejects noncanonical bytes and unknown fields', () => {
    const result = resolveProvider(request, [plain])
    const text = serializePolicyLock([buildLockEntry(request, result)])
    expect(() => parsePolicyLock(`${text}\n`)).toThrow(/not canonical/)
    const parsed = JSON.parse(text) as { entries: Record<string, unknown>[] }
    const first = parsed.entries[0]
    if (first === undefined) throw new Error('fixture needs a lock entry')
    first['secretFacet'] = { token: 'must-not-survive' }
    expect(() => parsePolicyLock(JSON.stringify(parsed))).toThrow(/missing or unknown fields/)
  })
})
