import { describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  createHostRealmProfile,
  createHostTopology,
  hostFacilityId,
  hostRealmCacheKey,
  runtimeTargetForHostRealm,
  type HostRealmProfile,
} from '@modkitx-x3/sdk'

function profile(overrides: Partial<HostRealmProfile> = {}): HostRealmProfile {
  return {
    schemaVersion: 1,
    realmId: 'org.modkitx.test/main',
    revision: '1',
    target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
    facilities: ['process.launch', 'filesystem.read-random', 'process.launch'],
    budgets: {
      maxConcurrentTasks: 4,
      maxWorkerCount: 2,
      maxResidentBytes: uint64('1073741824'),
      maxTransferBytes: uint64('67108864'),
      defaultDeadlineMs: 30_000,
    },
    policy: { id: 'org.modkitx.test/default', revision: '1' },
    ...overrides,
  }
}

describe('host profile v1', () => {
  it('owns, sorts and projects facilities into the legacy RuntimeTarget wire field', () => {
    const normalized = createHostRealmProfile(profile())
    expect(normalized.facilities).toEqual(['filesystem.read-random', 'process.launch'])
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized.facilities)).toBe(true)
    expect(runtimeTargetForHostRealm(normalized).hostCapabilities).toEqual(normalized.facilities)
  })

  it('accepts extension-owned qualified IDs and rejects unknown unqualified IDs', () => {
    expect(hostFacilityId('example.vendor/custom-broker')).toBe('example.vendor/custom-broker')
    expect(() => hostFacilityId('custom.broker')).toThrow(/unknown unqualified host facility/)
  })

  it('does not allow callers to author hostCapabilities or permission grants twice', () => {
    const invalid = profile({
      target: {
        environment: 'node',
        operatingSystem: 'windows',
        architecture: 'x64',
        hostCapabilities: ['process.launch'],
      } as never,
    })
    expect(() => createHostRealmProfile(invalid)).toThrow(/cannot be authored/)
  })

  it('validates realm links and produces a stable profile cache key', () => {
    const main = profile()
    const renderer = profile({
      realmId: 'org.modkitx.test/renderer',
      target: { environment: 'browser-main', operatingSystem: 'windows', architecture: 'x64' },
      facilities: ['gpu.webgl2'],
    })
    const topology = createHostTopology({
      schemaVersion: 1,
      topologyId: 'org.modkitx.test/application',
      realms: [renderer, main],
      links: [
        {
          fromRealm: renderer.realmId,
          toRealm: main.realmId,
          transports: ['rpc-handle', 'structured-clone'],
        },
      ],
    })
    expect(topology.realms.map(realm => realm.realmId)).toEqual([
      'org.modkitx.test/main',
      'org.modkitx.test/renderer',
    ])
    expect(topology.realms[1]?.facilities).toEqual(['gpu.webgl2'])
    expect(hostRealmCacheKey(main)).toBe(hostRealmCacheKey(profile()))
  })
})
