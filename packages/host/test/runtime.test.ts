import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostTopology } from '@modkitx-x3/sdk'
import type { RuntimeBudget } from '@modkitx-x3/sdk/runtime'
import {
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createHostComposition,
  createHostServiceResolver,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type HostComposition,
  type LinkedExtension,
} from '@modkitx-x3/host'
import { openRuntimeSession } from '@modkitx-x3/host/runtime'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import type { ExecutionProfile, RuntimeEnvironment } from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { counterRuntime } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', '_reference', 'counter-runtime', 'src', 'linked.js'))
    .href
)) as { readonly counterRuntime: LinkedExtension }

const REALM = 'org.modkitx.test/runtime-host'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/runtime',
  realms: [
    {
      schemaVersion: 1,
      realmId: REALM,
      revision: '1',
      target: { environment: 'node', operatingSystem: 'linux', architecture: 'x64' },
      facilities: [],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('134217728'),
        maxTransferBytes: uint64('16777216'),
        defaultDeadlineMs: 10_000,
      },
      policy: { id: 'org.modkitx.test/runtime-policy', revision: '1' },
    },
  ],
  links: [],
})
const activationBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

let composition: HostComposition
let definitions: ReturnType<typeof createBundledServiceDefinitionRegistry>

beforeAll(async () => {
  const linked = linkedExtensionInputs([counterRuntime])
  const executionBackends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  composition = await createHostComposition({
    topology,
    realmId: REALM,
    extensions: linked.inputs,
    executionBackends,
  })
  definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
})

const services = () => ({ ...composition, serviceDefinitions: definitions })

async function openCounter(budget: RuntimeBudget, sessionId: string) {
  const resolution = await openRuntimeSession({
    services: services(),
    runtimeId: 'reference.counter',
    sessionId,
    budget,
    grant: { id: `runtime-test-${sessionId}`, classes: [] },
    activationBudget,
  })
  expect(resolution.state).toBe('resolved')
  if (resolution.state !== 'resolved') throw new Error('counter runtime did not resolve')
  return resolution
}

describe('standard executable runtime contract and counter provider', () => {
  it('opens a leased session and accounts successful executions within its fixed budget', async () => {
    const resolution = await openCounter(
      { maxWallTimeMs: 20, maxTicks: 10, maxMemoryBytes: 1_024 },
      'successful-counter',
    )
    try {
      expect(await resolution.session.status()).toEqual({
        state: 'ready',
        executions: 0,
        ticks: 0,
        memoryBytes: 0,
      })
      await expect(
        resolution.session.execute({
          entrypoint: 'counter.advance',
          arguments: [3],
          resources: { wallTimeMs: 2, ticks: 4, memoryBytes: 128 },
        }),
      ).resolves.toEqual({
        state: 'completed',
        value: { counter: 3 },
        usage: { wallTimeMs: 2, ticks: 4, memoryBytes: 128 },
        diagnostics: [],
      })
      await expect(
        resolution.session.execute({
          entrypoint: 'counter.advance',
          arguments: [2],
          resources: { wallTimeMs: 1, ticks: 2, memoryBytes: 64 },
        }),
      ).resolves.toMatchObject({ state: 'completed', value: { counter: 5 } })
      expect(await resolution.session.status()).toEqual({
        state: 'ready',
        executions: 2,
        ticks: 6,
        memoryBytes: 192,
      })
    } finally {
      await resolution.release()
      await resolution.release()
    }
  })

  it('refuses every numeric ceiling with an exact reason, limit and requested value', async () => {
    const resolution = await openCounter(
      { maxWallTimeMs: 5, maxTicks: 6, maxMemoryBytes: 100 },
      'refusal-counter',
    )
    try {
      await expect(
        resolution.session.execute({
          entrypoint: 'counter.advance',
          arguments: [100],
          resources: { wallTimeMs: 6, ticks: 1, memoryBytes: 1 },
        }),
      ).resolves.toMatchObject({
        state: 'refused',
        reason: 'max-wall-time-ms',
        limit: 5,
        requested: 6,
        usage: { wallTimeMs: 0, ticks: 0, memoryBytes: 0 },
      })
      await expect(
        resolution.session.execute({
          entrypoint: 'counter.advance',
          arguments: [100],
          resources: { wallTimeMs: 1, ticks: 7, memoryBytes: 1 },
        }),
      ).resolves.toMatchObject({
        state: 'refused',
        reason: 'max-ticks',
        limit: 6,
        requested: 7,
      })
      await expect(
        resolution.session.execute({
          entrypoint: 'counter.advance',
          arguments: [100],
          resources: { wallTimeMs: 1, ticks: 1, memoryBytes: 101 },
        }),
      ).resolves.toMatchObject({
        state: 'refused',
        reason: 'max-memory-bytes',
        limit: 100,
        requested: 101,
      })
      expect(await resolution.session.status()).toEqual({
        state: 'ready',
        executions: 0,
        ticks: 0,
        memoryBytes: 0,
      })

      await resolution.session.execute({
        entrypoint: 'counter.advance',
        arguments: [1],
        resources: { wallTimeMs: 1, ticks: 4, memoryBytes: 80 },
      })
      await expect(
        resolution.session.execute({
          entrypoint: 'counter.advance',
          arguments: [100],
          resources: { wallTimeMs: 1, ticks: 3, memoryBytes: 1 },
        }),
      ).resolves.toMatchObject({
        state: 'refused',
        reason: 'max-ticks',
        limit: 6,
        requested: 7,
      })
      expect(await resolution.session.status()).toMatchObject({ executions: 1, ticks: 4 })
    } finally {
      await resolution.release()
    }
  })

  it('rejects invalid budgets before provider activation', async () => {
    const resolution = await openRuntimeSession({
      services: services(),
      runtimeId: 'reference.counter',
      sessionId: 'invalid-budget',
      budget: { maxWallTimeMs: 5, maxTicks: Number.NaN, maxMemoryBytes: 100 },
      grant: { id: 'runtime-test-invalid-budget', classes: [] },
      activationBudget,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/runtime-budget-invalid',
    )
  })

  it('does not select the counter offer for another runtime route', async () => {
    const resolution = await openRuntimeSession({
      services: services(),
      runtimeId: 'reference.other',
      sessionId: 'route-mismatch',
      budget: { maxWallTimeMs: 5, maxTicks: 6, maxMemoryBytes: 100 },
      grant: { id: 'runtime-test-mismatch', classes: [] },
      activationBudget,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/runtime-provider-unresolved',
    )
  })

  it('passes host-internal invocation context only to the gate-admitted trusted provider', async () => {
    const resources = Object.freeze({
      sessionId: 'trusted-pass-through',
      revision: 'provider-token:trusted-pass-through',
      state: () => 'live',
      resolve: () => Promise.reject(new Error('the counter does not resolve SC2 inputs')),
      provenance: () => Object.freeze([]),
      dispose: () => Promise.resolve(),
    })
    const resolution = await openRuntimeSession({
      services: services(),
      runtimeId: 'reference.counter',
      sessionId: 'trusted-invocation',
      budget: { maxWallTimeMs: 5, maxTicks: 6, maxMemoryBytes: 100 },
      grant: { id: 'runtime-test-trusted-invocation', classes: [] },
      activationBudget,
      providerInvocation: { resources: resources as never, inputs: [] },
    })
    expect(resolution.state).toBe('resolved')
    if (resolution.state === 'resolved') await resolution.release()
  })

  it('publishes mutation-resistant activation facts', async () => {
    const resolver = createHostServiceResolver({
      inventory: composition.inventory,
      target: composition.target,
      executionBackends: composition.executionBackends,
      definitions,
      grant: { id: 'runtime-test-activation-facts', classes: [] },
      budgets: activationBudget,
    })
    try {
      const lease = await resolver.port.resolve({
        contract: 'common.runtime/provider',
        major: 1,
        facet: { runtimeId: 'reference.counter' },
      })
      try {
        const facts = resolver.activationFacts
        expect(Object.isFrozen(facts)).toBe(true)
        expect(Object.isFrozen(facts[0])).toBe(true)
        expect(() => (facts as unknown[]).push({})).toThrow()
        expect(resolver.activationFacts).toHaveLength(1)
        expect(resolver.activationFacts[0]).toMatchObject({
          executionProfile: 'trusted-in-process',
          runtimeVariant: 'trusted-node',
        })
      } finally {
        await lease.release()
      }
    } finally {
      await resolver.release()
    }
  })

  it.each([
    ['worker-brokered', 'node-worker'],
    ['process-brokered', 'native'],
    ['remote-provider', 'external-tool'],
  ] as const)(
    'refuses providerInvocation before createSession for %s providers',
    async (profile: ExecutionProfile, environment: RuntimeEnvironment) => {
      const fixtureRoot = join(
        repoRoot,
        'packages',
        'host',
        'test',
        'fixtures',
        'runtime-provider-boundaries',
      )
      const providerModule = (await import(
        pathToFileURL(join(fixtureRoot, 'src', 'provider.js')).href
      )) as {
        resetCreateSessionCalls(): void
        getCreateSessionCalls(): number
      }
      providerModule.resetCreateSessionCalls()
      const extension = await loadExtensionDirectory(fixtureRoot)
      const inventory = await buildInventory([extension], createHostContributionContractRegistry())
      const serviceDefinitions = createBundledServiceDefinitionRegistry()
      await registerServiceDefinitionsOrThrow(inventory, serviceDefinitions)
      const executionBackends = createExecutionBackendRegistry([
        {
          profile,
          supports: (_target, variant) => variant.executionProfile === profile,
          async activate(context) {
            return Object.freeze({
              module: (await import(context.entrypoint.href)) as Record<string, unknown>,
              release: async () => undefined,
            })
          },
        },
      ])
      const resolution = await openRuntimeSession({
        services: {
          inventory,
          target: { environment, operatingSystem: 'windows', architecture: 'x64' },
          executionBackends,
          serviceDefinitions,
        },
        runtimeId: 'test.boundary',
        sessionId: `boundary-${profile}`,
        budget: { maxWallTimeMs: 5, maxTicks: 6, maxMemoryBytes: 100 },
        grant: { id: `runtime-boundary-${profile}`, classes: [] },
        activationBudget,
        providerInvocation: {
          resources: Object.freeze({}) as never,
          inputs: [],
        },
      })
      expect(resolution.state).toBe('unresolved')
      expect(resolution.diagnostics.map(item => item.code)).toContain(
        'x3.host/runtime-provider-invocation-boundary',
      )
      expect(providerModule.getCreateSessionCalls()).toBe(0)
    },
  )
})
