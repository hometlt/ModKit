import { beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import { createHostTopology, SERVICE_OPERATION_PROVIDER_CONTRACT } from '@modkit/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  discoverServiceOperations,
  defineLinkedExtension,
  invokeServiceOperation,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  validateServiceOperationProvider,
  validateServiceOperationResult,
  type HostComposition,
} from '@modkit/host'

const OPERATION_ID = 'modkit.test/echo'
const operationDescriptor = Object.freeze({
  schemaVersion: 1 as const,
  id: OPERATION_ID,
  title: 'Echo',
  summary: 'Return the input.',
  requiredPermissions: Object.freeze([]),
  effects: 'none' as const,
  inputSchema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      message: Object.freeze({ type: 'string' as const }),
      oversizedOutput: Object.freeze({ type: 'boolean' as const }),
      delay: Object.freeze({ type: 'boolean' as const }),
    }),
    additionalProperties: false,
  }),
  resultSchema: Object.freeze({ type: 'object' as const }),
  budget: Object.freeze({
    maxInputBytes: 1_024,
    maxOutputBytes: 1_024,
    maxWallTimeMs: 100,
  }),
})
const providerModule = {
  abiVersion: 1,
  provides: Object.freeze([SERVICE_OPERATION_PROVIDER_CONTRACT]),
  createProvider() {
    return Object.freeze({
      value: Object.freeze({
        contract: SERVICE_OPERATION_PROVIDER_CONTRACT,
        providerId: 'modkit.test/service-operation-provider',
        operations: Object.freeze([operationDescriptor]),
        async invoke(request: {
          readonly operationId: string
          readonly input: unknown
          readonly signal?: AbortSignal
        }) {
          if ((request.input as { delay?: unknown }).delay === true) {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 1_000)
              request.signal?.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer)
                  reject(request.signal?.reason)
                },
                { once: true },
              )
            })
          }
          const value =
            (request.input as { oversizedOutput?: unknown }).oversizedOutput === true
              ? { message: 'x'.repeat(2_000) }
              : request.input
          return Object.freeze({
            state: 'completed' as const,
            operationId: request.operationId,
            value,
            diagnostics: Object.freeze([]),
          })
        },
      }),
      release: async () => undefined,
    })
  },
}

const extension = defineLinkedExtension({
  source: 'linked:test/service-operation',
  packageJson: {
    name: '@modkit-test/service-operation',
    version: '1.0.0',
    license: 'MIT',
    modkit: {
      schemaVersion: 1,
      publisher: 'modkit.test',
      id: 'service-operation',
      contributionManifests: ['./contributions/provider.json'],
    },
  },
  contributions: [
    {
      path: 'contributions/provider.json',
      manifest: {
        schemaVersion: 1,
        contract: { id: 'modkit/service-provider-contribution', major: 1 },
        id: 'modkit.test/service-operation-provider',
        displayName: 'Test service operation',
        runtimeVariants: [
          {
            variantId: 'trusted-node',
            entrypoint: './src/provider.js',
            target: { environments: ['node'] },
            executionProfile: 'trusted-in-process',
            requestedPermissionClasses: [],
          },
        ],
        spec: {
          provides: [
            {
              offerId: 'echo-v1',
              contract: SERVICE_OPERATION_PROVIDER_CONTRACT,
              major: 1,
              version: '1.0.0',
              facet: { operationIds: [OPERATION_ID] },
            },
          ],
          lifecycleScope: 'operation',
        },
      },
    },
  ],
  modules: { './src/provider.js': providerModule },
})

const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'modkit.test/service-operation',
  realms: [
    {
      schemaVersion: 1,
      realmId: 'modkit.test/service-operation-host',
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
      policy: { id: 'modkit.test/service-operation-policy', revision: '1' },
    },
  ],
  links: [],
})

let composition: HostComposition
let definitions: ReturnType<typeof createBundledServiceDefinitionRegistry>

beforeAll(async () => {
  const linked = linkedExtensionInputs([extension])
  composition = await createHostComposition({
    topology,
    realmId: 'modkit.test/service-operation-host',
    extensions: linked.inputs,
    executionBackends: createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)]),
  })
  definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
})

describe('generic service operation provider', () => {
  it('discovers inert and activatable operation catalog entries with bounded paging', async () => {
    const common = {
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'service-operation-catalog-test', classes: [] },
      budgets: {
        maxInputBytes: 1_000_000n,
        maxDepth: 64,
        maxNodes: 100_000,
        maxScalarBytes: 1_000_000,
        maxDiagnostics: 100,
      },
      limit: 20,
    } as const
    await expect(discoverServiceOperations({ ...common, activate: false })).resolves.toMatchObject({
      total: 1,
      complete: true,
      entries: [
        {
          operationId: OPERATION_ID,
          state: 'eligible',
          declaredProviderIds: ['modkit.test/service-operation-provider'],
        },
      ],
    })
    await expect(discoverServiceOperations(common)).resolves.toMatchObject({
      entries: [
        {
          operationId: OPERATION_ID,
          state: 'activatable',
          selectedProviderId: 'modkit.test/service-operation-provider',
          descriptor: { id: OPERATION_ID },
        },
      ],
    })
    await expect(discoverServiceOperations({ ...common, limit: 101 })).rejects.toThrow(
      /offset\/limit/u,
    )
  })

  it('validates provider descriptors and provider results at the host boundary', () => {
    const provider = providerModule.createProvider().value
    expect(validateServiceOperationProvider(provider, OPERATION_ID)).toMatchObject({ valid: true })
    expect(
      validateServiceOperationProvider({
        ...provider,
        operations: [operationDescriptor, operationDescriptor],
      }),
    ).toMatchObject({ valid: false })
    expect(
      validateServiceOperationResult(
        { state: 'completed', operationId: 'modkit.test/wrong', value: {}, diagnostics: [] },
        OPERATION_ID,
        1_024,
        10,
      ),
    ).toMatchObject({ valid: false })
    expect(
      validateServiceOperationResult(
        { state: 'completed', operationId: OPERATION_ID, value: { message: 1 }, diagnostics: [] },
        OPERATION_ID,
        1_024,
        10,
        { type: 'object', properties: { message: { type: 'string' } } },
      ),
    ).toMatchObject({ valid: false, reason: expect.stringContaining('schema violation') })
  })

  it('selects an exact operation and invokes the provider through the host resolver', async () => {
    const inventoryRows = composition.inventory.extensions.flatMap(item =>
        item.contributions.map(contribution => ({
          extension: item.manifest,
          id: contribution.manifest?.id,
          eligible: contribution.activationEligible,
          diagnostics: contribution.diagnostics,
        })),
      )
    expect(inventoryRows, JSON.stringify(composition.inventory.extensions)).toContainEqual(
      expect.objectContaining({ id: 'modkit.test/service-operation-provider', eligible: true }),
    )
    const result = await invokeServiceOperation({
      services: { ...composition, serviceDefinitions: definitions },
      operationId: OPERATION_ID,
      input: { message: 'hello' },
      grant: { id: 'service-operation-test', classes: [] },
      budgets: {
        maxInputBytes: 1_000_000n,
        maxDepth: 64,
        maxNodes: 100_000,
        maxScalarBytes: 1_000_000,
        maxDiagnostics: 100,
      },
    })

    expect(result, JSON.stringify(result)).toMatchObject({ state: 'invoked' })
    if (result.state !== 'invoked') return
    expect(result.descriptor.id).toBe(OPERATION_ID)
    expect(result.result).toMatchObject({
      state: 'completed',
      operationId: OPERATION_ID,
      value: { message: 'hello' },
    })
  })

  it('falls back across runtime realms only when the primary target is unresolved', async () => {
    // A browser realm has no executable variant for this node-only provider, so the primary
    // target is unresolved and the fallback is exercised; `browser` is not a runtime environment.
    const browserTarget = { ...composition.target, environment: 'browser-main' as const }
    const common = {
      services: {
        ...composition,
        target: browserTarget,
        serviceDefinitions: definitions,
      },
      alternateTargets: [composition.target],
      grant: { id: 'service-operation-target-fallback-test', classes: [] },
      budgets: {
        maxInputBytes: 1_000_000n,
        maxDepth: 64,
        maxNodes: 100_000,
        maxScalarBytes: 1_000_000,
        maxDiagnostics: 100,
      },
    } as const

    await expect(discoverServiceOperations({ ...common, limit: 20 })).resolves.toMatchObject({
      entries: [{ operationId: OPERATION_ID, state: 'activatable' }],
    })
    await expect(
      invokeServiceOperation({
        ...common,
        operationId: OPERATION_ID,
        input: { message: 'alternate target' },
      }),
    ).resolves.toMatchObject({
      state: 'invoked',
      result: { state: 'completed', value: { message: 'alternate target' } },
    })
  })

  it('does not route an unadvertised operation to the provider', async () => {
    const result = await invokeServiceOperation({
      services: { ...composition, serviceDefinitions: definitions },
      operationId: 'modkit.test/missing',
      input: {},
      grant: { id: 'service-operation-missing-test', classes: [] },
      budgets: {
        maxInputBytes: 1_000_000n,
        maxDepth: 64,
        maxNodes: 100_000,
        maxScalarBytes: 1_000_000,
        maxDiagnostics: 100,
      },
    })
    expect(result.state).toBe('unresolved')
  })

  it('enforces input, output and wall-time limits around an activated provider', async () => {
    const invoke = (input: any) =>
      invokeServiceOperation({
        services: { ...composition, serviceDefinitions: definitions },
        operationId: OPERATION_ID,
        input,
        grant: { id: 'service-operation-budget-test', classes: [] },
        budgets: {
          maxInputBytes: 1_000_000n,
          maxDepth: 64,
          maxNodes: 100_000,
          maxScalarBytes: 1_000_000,
          maxDiagnostics: 100,
        },
      })

    const input = await invoke({ message: 'x'.repeat(2_000) })
    expect(input).toMatchObject({
      state: 'refused',
      stage: 'input',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'x3.host/service-operation-input-invalid' }),
      ]),
    })
    const inputSchema = await invoke({ unexpected: true })
    expect(inputSchema).toMatchObject({
      state: 'refused',
      stage: 'input',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'x3.host/service-operation-input-schema-violation' }),
      ]),
    })
    const output = await invoke({ oversizedOutput: true })
    expect(output).toMatchObject({
      state: 'failed',
      stage: 'result',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'x3.host/service-operation-result-invalid' }),
      ]),
    })
    const timeout = await invoke({ delay: true })
    expect(timeout).toMatchObject({
      state: 'failed',
      stage: 'invoke',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'x3.host/service-operation-cancelled' }),
      ]),
    })
  })
})
