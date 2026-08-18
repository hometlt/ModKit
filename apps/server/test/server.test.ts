import { describe, expect, it } from 'vitest'

import {
  createServerApp,
  createServerTopology,
  SERVER_REALM,
  SERVER_WORKER_REALM,
} from '../src/index.js'

describe('server composition root', () => {
  it('boots with an empty extension catalog', async () => {
    // The acceptance criterion from the apps plan: an empty catalog is a correct state, not a
    // bootstrap failure. A server that refused to start without extensions could never be deployed
    // before its content is installed.
    const app = await createServerApp()
    const health = app.health()
    expect(health.status).toBe('ok')
    expect(health.extensionCount).toBe(0)
    expect(health.realmId).toBe(SERVER_REALM)
    expect(health.topologyId).toBe('org.modkitx.app/server')
  })

  it('publishes a Node host realm and its worker realm, linked to each other and to nothing else', async () => {
    const topology = createServerTopology()
    expect(topology.realms.map(realm => realm.target.environment)).toEqual(['node', 'node-worker'])
    expect(topology.links).toHaveLength(2)
    expect(
      topology.links.every(link => [SERVER_REALM, SERVER_WORKER_REALM].includes(link.fromRealm)),
    ).toBe(true)
    const app = await createServerApp()
    expect(app.workers.profile.realmId).toBe(SERVER_WORKER_REALM)
    expect(app.workers.profile.facilities).toEqual([])
    expect(app.executionBackends.profiles).toEqual(['trusted-in-process', 'worker-brokered'])
    expect(app.composition.executionBackends).toBe(app.executionBackends)
  })

  it('reports the profile revision that keys resolution caches', async () => {
    const app = await createServerApp()
    expect(app.health().profileRevision).toBe(app.composition.profile.revision)
  })

  it('exposes filesystem and process facilities a deployment needs', async () => {
    const app = await createServerApp()
    const facilities = app.composition.profile.facilities
    expect(facilities).toContain('filesystem.read-random')
    expect(facilities).toContain('filesystem.atomic-replace')
    expect(facilities).toContain('worker.module')
    // Server is headless: nothing that implies a window or a user-facing editor.
    expect(facilities).not.toContain('editor.host-native')
    expect(facilities).not.toContain('window.custom-chrome')
    expect(facilities).not.toContain('dialog.file-picker')
  })

  it('freezes the health snapshot so a caller cannot mutate reported state', async () => {
    const app = await createServerApp()
    expect(Object.isFrozen(app.health())).toBe(true)
  })
})
