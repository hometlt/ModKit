import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commandRequest, COMMAND_PROTOCOL_SCHEMA_VERSION } from '@modkitx-x3/host'
import { openFileArtifactSource } from '@modkitx-x3/host/node'

import {
  AUTOMATION_REALM,
  AUTOMATION_WORKER_REALM,
  createAutomationHost,
  createAutomationTopology,
} from '../src/index.js'

describe('automation host composition root', () => {
  it('boots headless with only the mandatory native text contributions', async () => {
    const host = await createAutomationHost()
    const description = host.describeHost()
    expect(description.realmId).toBe(AUTOMATION_REALM)
    expect(description.contributions).toEqual([
      'org.modkitx/text-json',
      'org.modkitx/text-jsonc',
      'org.modkitx/txt',
      'org.modkitx/json-syntax-contract',
      'org.modkitx/jsonc-syntax-contract',
      'org.modkitx/json-syntax-default',
      'org.modkitx/jsonc-syntax-default',
      'org.modkitx/text-json-writer',
      'org.modkitx/plain-text-writer',
    ])
    expect(description.diagnostics).toBe(0)
    expect(host.commandContracts.schemaVersion).toBe(COMMAND_PROTOCOL_SCHEMA_VERSION)
    expect(host.commandContracts.commands).toHaveLength(6)
    expect(typeof host.runCommand).toBe('function')
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

  it('keeps running and describes a configured extension root that cannot be loaded', async () => {
    const host = await createAutomationHost([], {
      extensionRoots: ['Z:\\missing-modkit-extension'],
    })
    expect(host.describeHost().extensionRootFailures).toBe(1)
    expect(host.extensionRootFailures[0]?.root).toBe('Z:\\missing-modkit-extension')
  })
})

describe('automation open path (S7)', () => {
  it('an automation step opens a subject through the worker realm: portable variant, worker-brokered', async () => {
    const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
    const host = await createAutomationHost([], {
      extensionRoots: [join(repositoryRoot, 'extensions', 'common', 'images')],
    })
    expect(host.subjects.inventory).toBe(host.composition.inventory)
    expect(host.subjects.target).toBe(host.workers.target)
    const result = await host.subjects.open({
      source: await openFileArtifactSource(
        join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'),
      ),
      path: 'favicon-32.png',
      intent: 'full',
      grant: { id: 'automation-step', classes: ['read-source'] },
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

    const outsideGrant = await host.runCommand(
      commandRequest('subject.open', {
        subject: join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'),
      }),
      { roots: [join(repositoryRoot, 'extensions')] },
    )
    expect(outsideGrant.result).toMatchObject({
      state: 'failed',
      code: 'x3.command/failed',
    })
    if (outsideGrant.result.state !== 'failed') throw new Error('expected a bounded-root refusal')
    expect(outsideGrant.result.message).toMatch(/outside the granted roots/u)
  }, 30_000)

  it('keeps a disabled configured contribution inventoried but removes it from resolution', async () => {
    const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
    const host = await createAutomationHost([], {
      extensionRoots: [join(repositoryRoot, 'extensions', 'common', 'images')],
      disabledContributions: ['org.modkitx/image-png'],
    })
    expect(host.describeHost().contributions).toContain('org.modkitx/image-png')
    expect(host.subjects.supportedExtensions).toContain('png')
    expect(
      host.composition.inventory.extensions
        .flatMap(extension => extension.contributions)
        .some(
          contribution =>
            contribution.manifest?.id === 'org.modkitx/image-png' &&
            contribution.activationEligible === false,
        ),
    ).toBe(true)
    const result = await host.subjects.open({
      source: await openFileArtifactSource(
        join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'),
      ),
      path: 'favicon-32.png',
      intent: 'inspect',
      grant: { id: 'automation-disabled-check', classes: ['read-source'] },
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
