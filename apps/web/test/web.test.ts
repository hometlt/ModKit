import { describe, expect, it } from 'vitest'

import {
  createWebApp,
  createWebTopology,
  probeWebFacilities,
  WEB_MAIN_REALM,
  WEB_WORKER_REALM,
} from '../src/index.js'

const IDENTITY = { operatingSystem: 'windows', architecture: 'x64' } as const

/** A scope with nothing available — the floor a probe must degrade to without throwing. */
const bareScope = (): typeof globalThis =>
  ({ navigator: undefined, document: undefined, crossOriginIsolated: false }) as never

describe('web composition root', () => {
  it('splits main and worker realms and links them both ways', () => {
    const topology = createWebTopology(IDENTITY, { main: [], worker: [], sharedMemory: false })
    expect(topology.realms.map(realm => realm.realmId)).toEqual([WEB_MAIN_REALM, WEB_WORKER_REALM])
    expect(topology.links).toHaveLength(2)
    expect(topology.realms[0]?.target.environment).toBe('browser-main')
    expect(topology.realms[1]?.target.environment).toBe('browser-worker')
  })

  it('offers shared memory as a transport only when the page is cross-origin isolated', () => {
    const without = createWebTopology(IDENTITY, { main: [], worker: [], sharedMemory: false })
    expect(without.links[0]?.transports).not.toContain('shared-memory-view')

    const with_ = createWebTopology(IDENTITY, { main: [], worker: [], sharedMemory: true })
    expect(with_.links[0]?.transports).toContain('shared-memory-view')
  })

  it('probes without throwing when nothing is available', () => {
    const probe = probeWebFacilities(bareScope())
    expect(probe.main).toEqual([])
    expect(probe.worker).toEqual([])
    expect(probe.sharedMemory).toBe(false)
  })

  it('publishes a facility only when its API is actually present', () => {
    const scope = {
      fetch: () => undefined,
      Worker: function Worker() {
        // The probe only checks that the constructor exists, never calls it.
      },
      navigator: { storage: { estimate: () => undefined } },
      crossOriginIsolated: false,
    } as never
    const probe = probeWebFacilities(scope)
    expect(probe.main).toContain('network.range-fetch')
    expect(probe.main).toContain('worker.module')
    expect(probe.main).toContain('storage.quota')
    // Not probed as present, so it must not be promised.
    expect(probe.main).not.toContain('storage.opfs')
    expect(probe.main).not.toContain('dialog.file-picker')
    expect(probe.main).not.toContain('gpu.webgpu')
  })

  it('never publishes a native facility to a browser realm', async () => {
    const app = await createWebApp(IDENTITY, [], {
      main: ['worker.module'],
      worker: [],
      sharedMemory: false,
    })
    for (const profile of [app.main.profile, app.worker.profile]) {
      expect(profile.facilities).not.toContain('native.load')
      expect(profile.facilities).not.toContain('process.launch')
      expect(profile.facilities).not.toContain('native-process.rpc')
    }
  })

  it('does not leak main-realm facilities into the worker realm', async () => {
    const app = await createWebApp(IDENTITY, [], {
      main: ['dialog.file-picker', 'worker.module'],
      worker: [],
      sharedMemory: false,
    })
    expect(app.main.profile.facilities).toContain('dialog.file-picker')
    expect(app.worker.profile.facilities).not.toContain('dialog.file-picker')
  })

  it('boots both realms with an empty catalog', async () => {
    const app = await createWebApp(IDENTITY, [], { main: [], worker: [], sharedMemory: false })
    expect(app.main.inventory.extensions).toHaveLength(0)
    expect(app.worker.inventory.extensions).toHaveLength(0)
    expect(app.main.inventory.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0)
  })
})
