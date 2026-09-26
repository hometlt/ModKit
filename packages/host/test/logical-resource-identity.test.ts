import { describe, expect, it } from 'vitest'
import { createSubjectLogicalResources } from '../src/logical-resources.js'
import {
  logicalResourcesFromWire,
  wireLogicalResources,
} from '../src/execution/logical-resources.js'

const budget = {
  maxInputBytes: 1n << 20n,
  maxDepth: 8,
  maxNodes: 100,
  maxScalarBytes: 1 << 16,
  maxDiagnostics: 10,
}

function port(primaryLogicalId: string | undefined, authorized = true) {
  const resources = {
    sessionId: 'identity',
    revision: 'provider-token:identity',
    ...(primaryLogicalId === undefined ? {} : { primaryLogicalId }),
    state: () => 'live' as const,
    resolve: async () => {
      throw new Error('unused')
    },
    provenance: () => [],
    dispose: async () => undefined,
  }
  const state = { live: true, reservedBytes: 0, resolveCalls: 0, discoveryCalls: 0, resources }
  return createSubjectLogicalResources({ state, budget, isAuthorized: () => authorized } as never)
}

describe('logical resource identity', () => {
  it('names where the opened subject sits, also across the worker wire', async () => {
    const opened = port('Stormgate/Content/Characters/Hero/SK_Hero.uasset')
    expect(await opened.identity!()).toEqual({
      primaryLogicalId: 'Stormgate/Content/Characters/Hero/SK_Hero.uasset',
    })
    expect(await logicalResourcesFromWire(wireLogicalResources(opened)).identity!()).toEqual({
      primaryLogicalId: 'Stormgate/Content/Characters/Hero/SK_Hero.uasset',
    })
  })

  it('answers nothing without an origin or without read permission', async () => {
    expect(await port(undefined).identity!()).toBeUndefined()
    expect(await port('A.uasset', false).identity!()).toBeUndefined()
  })
})
