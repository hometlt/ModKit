import { describe, expect, it } from 'vitest'

import { AUTOMATION_REALM, createAutomationHost, createAutomationTopology } from '../src/index.js'

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

  it('runs in a single realm with no cross-realm links to broker', () => {
    const topology = createAutomationTopology()
    expect(topology.realms).toHaveLength(1)
    expect(topology.links).toHaveLength(0)
  })

  it('freezes its description', async () => {
    const host = await createAutomationHost()
    expect(Object.isFrozen(host.describeHost())).toBe(true)
  })
})
