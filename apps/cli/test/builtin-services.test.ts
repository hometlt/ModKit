import { createHostServiceResolver } from '@modkit/host'
import { DEFAULT_SUBJECT_OPEN_BUDGET } from '@modkit/host/node'
import { describe, expect, it } from 'vitest'
import { createModkitCliSubjectServices } from '../src/profile.js'

describe('built-in services of the CLI composition', () => {
  it('a codec activated for the worker realm resolves the linked UVM materializer in the host process', async () => {
    const services = await createModkitCliSubjectServices([])
    expect(services.target.environment).toBe('node-worker')
    const resolver = createHostServiceResolver({
      inventory: services.inventory,
      target: services.target,
      executionBackends: services.executionBackends,
      definitions: services.serviceDefinitions!,
      grant: { id: 'cli-test', classes: ['read-source'] },
      budgets: DEFAULT_SUBJECT_OPEN_BUDGET,
    })
    try {
      const lease = await resolver.port.resolveUnknown({
        contract: 'common.uv/model-materializer',
        major: 1,
      })
      expect(typeof (lease.value as { materialize?: unknown }).materialize).toBe('function')
      expect(
        resolver.activationFacts.map(fact => [fact.runtimeVariant, fact.executionProfile]),
      ).toEqual([['trusted-node', 'trusted-in-process']])
    } finally {
      await resolver.release()
    }
  })
})
