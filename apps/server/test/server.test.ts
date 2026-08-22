import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openFileArtifactSource } from '@modkitx-x3/host/node'

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

  it('keeps running and reports a configured extension root that cannot be loaded', async () => {
    const app = await createServerApp([], { extensionRoots: ['Z:\\missing-modkit-extension'] })
    expect(app.health()).toMatchObject({ status: 'degraded', extensionRootFailureCount: 1 })
    expect(app.extensionRootFailures[0]?.root).toBe('Z:\\missing-modkit-extension')
  })
})

describe('server open path (S7)', () => {
  it('opens a subject for a client through the worker realm: portable variant, worker-brokered', async () => {
    const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
    const app = await createServerApp([], {
      extensionRoots: [join(repositoryRoot, 'extensions', 'common', 'images')],
    })
    expect(app.subjects.inventory).toBe(app.composition.inventory)
    expect(app.subjects.target).toBe(app.workers.target)
    expect(app.subjects.supportedExtensions).toContain('png')
    const result = await app.subjects.open({
      source: await openFileArtifactSource(
        join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'),
      ),
      path: 'favicon-32.png',
      intent: 'inspect',
      grant: { id: 'server-request', classes: ['read-source'] },
      budget: {
        maxInputBytes: 10_000_000n,
        maxDepth: 128,
        maxNodes: 100_000,
        maxScalarBytes: 1_000_000,
        maxDiagnostics: 100,
      },
    })
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') throw new Error(result.reason)
    expect(result.selected).toMatchObject({
      contributionId: 'org.modkitx/image-png',
      variantId: 'portable',
    })
    expect(result.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')
    await result.session.dispose()
  }, 30_000)

  it('keeps a disabled configured contribution inventoried but removes it from resolution', async () => {
    const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
    const app = await createServerApp([], {
      extensionRoots: [join(repositoryRoot, 'extensions', 'common', 'images')],
      disabledContributions: ['org.modkitx/image-png'],
    })
    expect(app.composition.inventory.extensions).toHaveLength(1)
    expect(app.subjects.supportedExtensions).toContain('png')
    expect(
      app.composition.inventory.extensions[0]?.contributions.some(
        contribution =>
          contribution.manifest?.id === 'org.modkitx/image-png' &&
          contribution.activationEligible === false,
      ),
    ).toBe(true)
    const result = await app.subjects.open({
      source: await openFileArtifactSource(
        join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'),
      ),
      path: 'favicon-32.png',
      intent: 'inspect',
      grant: { id: 'server-disabled-check', classes: ['read-source'] },
      budget: {
        maxInputBytes: 10_000_000n,
        maxDepth: 128,
        maxNodes: 100_000,
        maxScalarBytes: 1_000_000,
        maxDiagnostics: 100,
      },
    })
    expect(result.state).not.toBe('opened')
  })
})
