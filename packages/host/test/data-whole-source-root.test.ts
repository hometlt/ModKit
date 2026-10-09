import { beforeAll, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import { createHostTopology, revisionId, type ResourceSessionPort, type ContributionContext,
  type ModContextQueryPort } from '@modkit/sdk'
import { RESOLVED_DATA_WORKSPACE_CONTRACT } from '@modkit/sdk/data'
import type { DataWorkspacePlan } from '@modkit/sdk/data'
import type { ModWorkspaceLock } from '@modkit/sdk/mods'
import {
  analyzeResolvedDataWorkspace,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  defineLinkedExtension,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type DataHostServices,
} from '@modkit/host'

const REALM = 'org.modkit.test/whole-source-root-host'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkit.test/whole-source-root',
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
      policy: { id: 'org.modkit.test/whole-source-root-policy', revision: '1' },
    },
  ],
  links: [],
})
const budgets = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

/** What the provider was handed to analyse: the paths of its documents. */
let analysed: readonly string[] | undefined
let creationCandidates: DataWorkspacePlan['creationCandidates']
let resourceReads = 0
let receivedPort: ModContextQueryPort | undefined

const notUsed = async () => {
  throw new Error('not used')
}
const provider = {
  contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
  providerId: 'fixture-data',
  gameIds: ['fixture-game'],
  plan: async (request: { workspace: ModWorkspaceLock }) => ({
    schemaVersion: 1,
    workspaceId: request.workspace.workspaceId,
    gameId: request.workspace.gameId,
    analyzerId: 'fixture-data',
    requirements: [
      {
        requirementId: 'catalog:game:rulesmd.ini',
        rootId: 'game',
        path: `${request.workspace.loadOrder[0]?.sourcePath === '' ? '' : `${request.workspace.loadOrder[0]?.sourcePath}/`}rulesmd.ini`,
        kind: 'catalog',
      },
    ],
    ...(creationCandidates === undefined ? {} : { creationCandidates }),
    diagnostics: [],
    complete: true,
  }),
  analyze: async (request: { documents: readonly { path: string }[] }) => {
    analysed = request.documents.map(document => document.path)
    throw new Error('analysed')
  },
  openSchemaTree: notUsed,
  openDefinitionTable: notUsed,
  openLocalizationTable: notUsed,
  openRelations: notUsed,
}

const fixture = defineLinkedExtension({
  source: 'linked:test/whole-source-root',
  packageJson: {
    name: 'modkit-test-whole-source-root',
    version: '1.0.0',
    license: 'MIT',
    type: 'module',
    description: 'Resolved data provider over a whole-source root.',
    modkit: {
      schemaVersion: 1,
      publisher: 'org.modkit.test',
      id: 'whole-source-root',
      contributionManifests: ['./contributions/data.json'],
    },
  },
  contributions: [
    {
      path: 'contributions/data.json',
      manifest: {
        schemaVersion: 1,
        contract: { id: 'org.modkitx/service-provider-contribution', major: 1 },
        id: 'org.modkit.test/whole-source-root-data',
        displayName: 'Whole-source root data provider',
        runtimeVariants: [
          {
            variantId: 'trusted-node',
            entrypoint: './src/data-provider.js',
            target: { environments: ['node'] },
            executionProfile: 'trusted-in-process',
            requestedPermissionClasses: [],
          },
        ],
        spec: {
          provides: [
            {
              offerId: 'fixture-data-v1',
              contract: 'common.data/resolved-workspace',
              major: 1,
              version: '1.0.0',
              facet: { gameIds: ['fixture-game'] },
            },
          ],
          lifecycleScope: 'session',
        },
      },
    },
  ],
  modules: {
    './src/data-provider.js': {
      abiVersion: 1,
      provides: ['common.data/resolved-workspace'],
      createProvider: (_selection: unknown, context: ContributionContext) => {
        receivedPort = context.modContexts
        return { value: provider, release: async () => undefined }
      },
    },
  },
})

let services: DataHostServices

beforeAll(async () => {
  const linked = linkedExtensionInputs([fixture])
  const executionBackends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  const composition = await createHostComposition({
    topology,
    realmId: REALM,
    extensions: linked.inputs,
    executionBackends,
  })
  const definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
  services = { ...composition, serviceDefinitions: definitions }
})

const revision = revisionId('provider-token:rules')
const rules = new TextEncoder().encode('[General]\n')
const resources = {
  state: () => 'live',
  async resolve() {
    resourceReads += 1
    return {
      state: 'resolved',
      revision,
      provenance: {},
      lease: {
        value: {
          kind: 'bytes',
          ref: { id: 'rulesmd.ini', uri: 'test:rulesmd.ini' },
          revision,
          size: BigInt(rules.byteLength),
          async *stream() {
            yield rules
          },
        },
        release: async () => undefined,
      },
    }
  },
} as unknown as ResourceSessionPort

/** Exercise the public activation/validation/read path with an independently declared destination. */
async function runAnalysis(
  root: { rootId: string; sourcePath: string; caseSensitive?: boolean },
  candidates?: DataWorkspacePlan['creationCandidates'],
  contextServices = services,
) {
  analysed = undefined
  resourceReads = 0
  creationCandidates = candidates
  receivedPort = undefined
  const workspace = {
    schemaVersion: 1,
    workspaceId: 'westwood',
    gameId: 'fixture-game',
    activeRootId: 'game',
    sources: [],
    loadOrder: [root],
    dependencyOrder: [],
    diagnostics: [],
    complete: true,
  } as unknown as ModWorkspaceLock
  return analyzeResolvedDataWorkspace({
    services: contextServices,
    grant: { id: 'whole-source-root-test', classes: [] },
    budgets,
    workspace,
    resources,
    locales: [],
    queries: [],
    limits: {
      maxRequirements: 8,
      maxDocumentBytes: 1024,
      maxTextBytes: 4096,
      maxEntities: 8,
      maxDepth: 8,
      maxPageSize: 8,
    },
  })
}

it('reads a document under a root that is its whole source (a game installation layer)', async () => {
  const result = await runAnalysis({ rootId: 'game', sourcePath: '' })
  expect(analysed).toEqual(['rulesmd.ini'])
  expect(result.diagnostics.map(item => item.message)).toContain('analysed')
})

it('forwards the optional canonical query capability to a generic root Data provider and preserves standalone absence', async () => {
  const port: ModContextQueryPort = { query: async (_scope, question) => question }
  const result = await runAnalysis({ rootId: 'game', sourcePath: '' }, undefined,
    { ...services, modContexts: port, preferTrustedInProcess: true })
  expect(result.diagnostics.map(item => item.message)).toContain('analysed')
  expect(await receivedPort?.query('fixture-scope', { question: true })).toEqual({ question: true })
  await runAnalysis({ rootId: 'game', sourcePath: '' })
  expect(receivedPort).toBeUndefined()
})

it.each([
  { root: { rootId: 'game', sourcePath: '' }, candidates: [{ rootId: 'other', path: 'x.xml' }], error: /active root/u },
  { root: { rootId: 'game', sourcePath: '' }, candidates: [{ rootId: 'game', path: '../x.xml' }], error: /workspace root/u },
  { root: { rootId: 'game', sourcePath: 'Mods/Mod' }, candidates: [{ rootId: 'game', path: 'Mods/Other/x.xml' }], error: /escapes its root/u },
  { root: { rootId: 'game', sourcePath: 'Mods/Mod', caseSensitive: true }, candidates: [{ rootId: 'game', path: 'mods/mod/x.xml' }], error: /escapes its root/u },
  { root: { rootId: 'game', sourcePath: '' }, candidates: [{ rootId: 'game', path: 'X.xml' }, { rootId: 'game', path: 'x.xml' }], error: /duplicated/u },
  { root: { rootId: 'game', sourcePath: '' }, candidates: Array.from({ length: 9 }, (_, index) => ({ rootId: 'game', path: `${index}.xml` })), error: /budget/u },
  { root: { rootId: 'game', sourcePath: '' }, candidates: null as unknown as DataWorkspacePlan['creationCandidates'], error: /invalid/u },
])('refuses invalid creation candidates before reading resources: $error', async ({ root, candidates, error }) => {
  const result = await runAnalysis(root, candidates)
  expect(result.diagnostics.map(item => item.message).join('\n')).toMatch(error)
  expect(resourceReads).toBe(0)
  expect(analysed).toBeUndefined()
})

it.each([
  { root: { rootId: 'game', sourcePath: 'Mods/Mod' }, candidates: [{ rootId: 'game', path: 'mods/mod/New.xml' }] },
  { root: { rootId: 'game', sourcePath: '', caseSensitive: true }, candidates: [{ rootId: 'game', path: 'X.xml' }, { rootId: 'game', path: 'x.xml' }] },
])('valid creation candidates request no additional reads: $root', async ({ root, candidates }) => {
  const result = await runAnalysis(root, candidates)
  expect(result.diagnostics.map(item => item.message)).toContain('analysed')
  expect(analysed).toEqual([`${root.sourcePath === '' ? '' : `${root.sourcePath}/`}rulesmd.ini`])
  expect(resourceReads).toBe(1)
})
