import { describe, expect, it } from 'vitest'

import {
  AUTOMATION_REALM,
  AUTOMATION_WORKER_REALM,
  createAutomationHost,
  createAutomationTopology,
} from '../src/index.js'

describe('automation host composition root', () => {
  it('boots headless with an empty catalog', async () => {
    const host = await createAutomationHost()
    const description = host.describeHost()
    expect(description.realmId).toBe(AUTOMATION_REALM)
    expect(description.contributions).toEqual([])
    expect(description.diagnostics).toBe(0)
  })

  it('inspects the same composition contract the interactive apps use', async () => {
    const host = await createAutomationHost()
    // The point of this app type: a tool surface over the identical host composition, so what an
    // automation run sees cannot drift from what a user-facing host resolved.
    expect(host.composition.profile.realmId).toBe(host.describeHost().realmId)
    expect(host.describeHost().facilities).toEqual(host.composition.profile.facilities)
  })

  it('runs in a host realm plus its worker realm; the only links join the two', async () => {
    const topology = createAutomationTopology()
    expect(topology.realms.map(realm => realm.target.environment)).toEqual(['node', 'node-worker'])
    expect(topology.links).toHaveLength(2)
    const host = await createAutomationHost()
    expect(host.workers.profile.realmId).toBe(AUTOMATION_WORKER_REALM)
    expect(host.executionBackends.profiles).toEqual(['trusted-in-process', 'worker-brokered'])
  })

  it('freezes its description', async () => {
    const host = await createAutomationHost()
    expect(Object.isFrozen(host.describeHost())).toBe(true)
  })
})
