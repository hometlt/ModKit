import { describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostComposition, EXTENSION_DISABLED_CODE } from '@modkitx-x3/host'

describe('host composition root', () => {
  it('starts with only the native text inventory and keeps realm facilities isolated', async () => {
    const composition = await createHostComposition({
      realmId: 'org.modkitx.test/renderer',
      topology: {
        schemaVersion: 1,
        topologyId: 'org.modkitx.test/electron',
        realms: [
          {
            schemaVersion: 1,
            realmId: 'org.modkitx.test/main',
            revision: '1',
            target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
            facilities: ['process.launch'],
            budgets: {
              maxConcurrentTasks: 4,
              maxWorkerCount: 2,
              maxResidentBytes: uint64('1000000'),
              maxTransferBytes: uint64('100000'),
              defaultDeadlineMs: 1000,
            },
            policy: { id: 'org.modkitx.test/default', revision: '1' },
          },
          {
            schemaVersion: 1,
            realmId: 'org.modkitx.test/renderer',
            revision: '1',
            target: {
              environment: 'browser-main',
              operatingSystem: 'windows',
              architecture: 'x64',
            },
            facilities: ['gpu.webgl2'],
            budgets: {
              maxConcurrentTasks: 2,
              maxWorkerCount: 1,
              maxResidentBytes: uint64('500000'),
              maxTransferBytes: uint64('100000'),
              defaultDeadlineMs: 1000,
            },
            policy: { id: 'org.modkitx.test/renderer', revision: '1' },
          },
        ],
        links: [
          {
            fromRealm: 'org.modkitx.test/renderer',
            toRealm: 'org.modkitx.test/main',
            transports: ['rpc-handle'],
          },
        ],
      },
    })
    expect(composition.inventory.extensions).toHaveLength(1)
    expect(composition.inventory.extensions[0]).toMatchObject({
      source: 'native:core/text',
      origin: 'bundled',
      manifest: { publisher: 'org.modkitx', id: 'core-native-text' },
    })
    expect(composition.target.hostCapabilities).toEqual(['gpu.webgl2'])
    expect(composition.target.hostCapabilities).not.toContain('process.launch')
    expect(composition.executionBackends.profiles).toEqual(['trusted-in-process'])
  })

  it('threads disabled extension coordinates into the composed inventory', async () => {
    const composition = await createHostComposition({
      realmId: 'org.modkitx.test/renderer',
      disabledExtensions: ['org.modkitx/core-native-text'],
      topology: {
        schemaVersion: 1,
        topologyId: 'org.modkitx.test/disabled-extension',
        realms: [
          {
            schemaVersion: 1,
            realmId: 'org.modkitx.test/renderer',
            revision: '1',
            target: {
              environment: 'browser-main',
              operatingSystem: 'windows',
              architecture: 'x64',
            },
            facilities: [],
            budgets: {
              maxConcurrentTasks: 1,
              maxWorkerCount: 0,
              maxResidentBytes: uint64('1000000'),
              maxTransferBytes: uint64('100000'),
              defaultDeadlineMs: 1000,
            },
            policy: { id: 'org.modkitx.test/default', revision: '1' },
          },
        ],
        links: [],
      },
    })
    const contributions = composition.inventory.extensions[0]?.contributions ?? []
    expect(contributions.length).toBeGreaterThan(0)
    expect(contributions.every(item => !item.activationEligible)).toBe(true)
    expect(
      contributions.every(item =>
        item.diagnostics.some(diagnostic => diagnostic.code === EXTENSION_DISABLED_CODE),
      ),
    ).toBe(true)
  })
})
