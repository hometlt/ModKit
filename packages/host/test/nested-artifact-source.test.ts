/** Nested opens retain provider identity and release the native source on every exit. */
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { revisionId, type AssetSession, type NamespaceEntrySource } from '@modkit/sdk'
import {
  buildInventory,
  createHostContributionContractRegistry,
  type Inventory,
} from '@modkit/host'
import { loadExtensionDirectory } from '../src/node/loader.js'
import { createExecutionBackendRegistry } from '../src/execution/backend.js'
import { artifactByteSourceFromBytes } from '../src/source-bridge.js'
import { openNestedSubject } from '../src/nested-subject.js'

const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'native-nested', classes: ['read-source'] } as const
const budget = {
  maxInputBytes: 65536n,
  maxNodes: 1000,
  maxDepth: 16,
  maxScalarBytes: 65536,
  maxDiagnostics: 32,
}
let inventory: Inventory

// Inventory/schema preparation is shared fixture setup, not part of each lease lifetime.
beforeAll(async () => {
  const loaded = await loadExtensionDirectory(
    join(import.meta.dirname, 'fixtures', 'companion-namespace-extension'),
  )
  inventory = await buildInventory(
    [{ ...loaded, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
    createHostContributionContractRegistry(),
  )
})

/** Reuse the existing inspection fixture rather than inventing another codec implementation. */
async function setup(
  mode: 'opened' | 'unclaimed' | 'acquire-failure' | 'codec-failure' | 'release-failure',
) {
  const counts = { ref: 0, artifact: 0, namespace: 0, legacy: 0, extraction: 0 }
  const original = artifactByteSourceFromBytes(
    { id: 'native-CAB', uri: 'native://CAB' },
    revisionId('provider-token:native'),
    new TextEncoder().encode(mode === 'unclaimed' ? 'WRONG unclaimed' : 'MESH\0nested fixture'),
    { native: 'selected' },
  )
  let observed: unknown
  const executionBackends = createExecutionBackendRegistry([
    {
      profile: 'trusted-in-process',
      supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
      async activate(context) {
        const module = await import(context.entrypoint.href)
        return {
          module: {
            ...module,
            createCodec(...args: unknown[]) {
              observed = args[0]
              const codec = module.createCodec(...args)
              return {
                ...codec,
                async open(...openArgs: unknown[]) {
                  if (mode === 'codec-failure') throw new Error('native codec failure')
                  return codec.open(...openArgs)
                },
              }
            },
          },
          release: async () => undefined,
        }
      },
    },
  ])
  const entry = {
    id: 'props/native.mesh',
    path: 'props/native.mesh',
    name: 'native.mesh',
    kind: 'file' as const,
    rangeAccess: true as const,
    size: original.size,
  }
  const namespace: NamespaceEntrySource = {
    list: async () => ({ items: [entry] }),
    lookup: async path => (path === entry.id ? entry : undefined),
    async openEntry() {
      return {
        value: { id: 'listing-ref', uri: 'listing://wrong' },
        release: async () => {
          counts.ref += 1
          if (mode === 'release-failure') throw new Error('ref teardown failure')
        },
      }
    },
    async openEntryArtifactSource() {
      if (mode === 'acquire-failure') throw new Error('native acquisition failure')
      return {
        value: original,
        release: async () => {
          counts.artifact += 1
        },
      }
    },
    async openEntrySource() {
      counts.legacy += 1
      throw new Error('legacy source forbidden')
    },
    async nestedContext() {
      throw new Error('namespace context must not replace native context')
    },
  }
  const parent = {
    descriptor: async () => ({
      revision: revisionId('provider-token:parent'),
      operations: [{ id: 'container.extract', state: 'available', handlerId: 'extract' }],
      dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
    }),
    dataSource: async () => ({
      value: namespace,
      release: async () => {
        counts.namespace += 1
      },
    }),
    operations: () => ({
      invoke: async () => {
        counts.extraction += 1
        throw new Error('whole extraction forbidden')
      },
    }),
  } as unknown as AssetSession
  return {
    counts,
    original,
    observed: () => observed,
    open: () =>
      openNestedSubject({
        parent,
        entryId: entry.id,
        inventory,
        target,
        grant,
        budget,
        executionBackends,
      }),
  }
}

describe('nested provider-pinned artifact source', () => {
  it('keeps native revision/context through a real codec and holds leases until child disposal', async () => {
    const fixture = await setup('opened')
    const opened = await fixture.open()
    expect(opened.result.state).toBe('opened')
    if (opened.result.state !== 'opened') throw new Error(JSON.stringify(opened.result))
    expect(opened.result.session.revision).toBe(fixture.original.revision)
    expect(fixture.observed()).toEqual(
      expect.objectContaining({ containerContext: { native: 'selected' } }),
    )
    expect(fixture.counts).toEqual({ ref: 0, artifact: 0, namespace: 0, legacy: 0, extraction: 0 })
    await opened.result.session.dispose()
    await opened.result.session.dispose()
    expect(fixture.counts).toEqual({ ref: 1, artifact: 1, namespace: 1, legacy: 0, extraction: 0 })
  })
  it.each(['unclaimed', 'acquire-failure', 'codec-failure'] as const)(
    'releases every acquired lease after %s',
    async mode => {
      const fixture = await setup(mode)
      try {
        const opened = await fixture.open()
        expect(opened.result.state).not.toBe('opened')
      } catch (error) {
        expect(String(error)).toMatch(/native (acquisition|codec) failure/)
      }
      expect(fixture.counts).toEqual({
        ref: 1,
        artifact: mode === 'acquire-failure' ? 0 : 1,
        namespace: 1,
        legacy: 0,
        extraction: 0,
      })
    },
  )
  it('releases artifact and namespace even when the ref lease rejects teardown', async () => {
    const fixture = await setup('release-failure')
    const opened = await fixture.open()
    if (opened.result.state !== 'opened') throw new Error(JSON.stringify(opened.result))
    await expect(opened.result.session.dispose()).rejects.toThrow('ref teardown failure')
    await opened.result.session.dispose()
    expect(fixture.counts).toEqual({ ref: 1, artifact: 1, namespace: 1, legacy: 0, extraction: 0 })
  })
})
