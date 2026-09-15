import { beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import { createHostTopology, SERVICE_OPERATION_PROVIDER_CONTRACT } from '@modkit/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  defineLinkedExtension,
  invokeServiceOperation,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type HostComposition,
} from '@modkit/host'

const OPERATION_ID = 'modkit.test/echo'
const providerModule = {
  abiVersion: 1,
  provides: Object.freeze([SERVICE_OPERATION_PROVIDER_CONTRACT]),
  createProvider() {
    return Object.freeze({
      value: Object.freeze({
        contract: SERVICE_OPERATION_PROVIDER_CONTRACT,
        providerId: 'modkit.test/echo-provider',
        operations: Object.freeze([
          Object.freeze({
            schemaVersion: 1 as const,
            id: OPERATION_ID,
            title: 'Echo',
            summary: 'Return the input.',
            requiredPermissions: Object.freeze([]),
            effects: 'none' as const,
            inputSchema: Object.freeze({ type: 'object' as const }),
            resultSchema: Object.freeze({ type: 'object' as const }),
            budget: Object.freeze({
              maxInputBytes: 1_024,
              maxOutputBytes: 1_024,
              maxWallTimeMs: 1_000,
            }),
          }),
        ]),
        async invoke(request: { readonly operationId: string; readonly input: unknown }) {
          return Object.freeze({
            state: 'completed' as const,
            operationId: request.operationId,
            value: request.input,
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
})
