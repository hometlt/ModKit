import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commandRequest, COMMAND_PROTOCOL_SCHEMA_VERSION } from '@modkitx-x3/host'
import { openFileArtifactSource } from '@modkitx-x3/host/node'

import {
  createServerApp,
  createServerTopology,
  SERVER_REALM,
  SERVER_WORKER_REALM,
} from '../src/index.js'

describe('server composition root', () => {
  it('boots with only the mandatory native text inventory', async () => {
    // No configured extension is a correct state. Native plain/JSON support is part of Core rather
    // than installed content, so it remains present without making startup depend on a catalog.
    const app = await createServerApp()
    const health = app.health()
    expect(health.status).toBe('ok')
    expect(health.extensionCount).toBe(1)
    expect(app.composition.inventory.extensions[0]).toMatchObject({
      source: 'native:core/text',
      manifest: { publisher: 'org.modkitx', id: 'core-native-text' },
    })
    expect(health.realmId).toBe(SERVER_REALM)
    expect(health.topologyId).toBe('org.modkitx.app/server')
    expect(app.commandContracts.schemaVersion).toBe(COMMAND_PROTOCOL_SCHEMA_VERSION)
    expect(app.commandContracts.commands).toHaveLength(6)
    expect(typeof app.runCommand).toBe('function')
  })

  it('is a real shared-command caller with the same typed refusal as the other apps', async () => {
    const app = await createServerApp()
    const receipt = await app.runCommand(
      commandRequest('org.example/not-installed', { subject: 'unused.bin' }),
      { roots: [] },
    )
    expect(receipt).toMatchObject({
      schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
      result: {
        state: 'failed',
        command: 'org.example/not-installed',
        code: 'x3.command/unknown',
        diagnostics: [],
      },
    })
  })

  it('runs a known command through the server bounded path opener', async () => {
    const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
    const app = await createServerApp()
    const receipt = await app.runCommand(
      commandRequest('subject.open', {
        subject: join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'),
      }),
      { roots: [join(repositoryRoot, 'extensions')] },
    )
    expect(receipt.result).toMatchObject({ state: 'failed', code: 'x3.command/failed' })
    if (receipt.result.state !== 'failed') throw new Error('expected a bounded-root refusal')
    expect(receipt.result.message).toMatch(/outside the granted roots/u)
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
      extensionRoots: [join(repositoryRoot, 'extensions', 'images')],
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
      extensionRoots: [join(repositoryRoot, 'extensions', 'images')],
      disabledContributions: ['org.modkitx/image-png'],
    })
    expect(app.composition.inventory.extensions).toHaveLength(2)
    expect(app.subjects.supportedExtensions).toContain('png')
    expect(
      app.composition.inventory.extensions
        .flatMap(extension => extension.contributions)
        .some(
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
