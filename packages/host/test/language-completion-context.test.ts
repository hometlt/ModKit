import { expect, it, vi } from 'vitest'
import { OperationCancelledError, uint64 } from '@modkit/core'
import { createHostTopology } from '@modkit/sdk'
import { LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT, type LanguageProvider } from '@modkit/sdk/language'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  defineLinkedExtension,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
} from '../src/index.js'
import {
  createLanguageWorkspace,
  type LanguageWorkspaceDocumentSource,
} from '../src/language/index.js'

async function fixture(selector?: LanguageProvider['completionContext']) {
  const completion = vi.fn(async () => ({
    items: [{ label: 'schema-field', kind: 'field' as const }],
    isIncomplete: false,
  }))
  const provider: LanguageProvider = {
    contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
    languageIds: ['fixture'],
    analyze: async ({ document }) => ({
      documentUri: document.uri,
      documentVersion: document.version,
      tokens: [],
      diagnostics: [],
      symbols: [],
    }),
    completion,
    ...(selector === undefined ? {} : { completionContext: selector }),
  }
  const extension = defineLinkedExtension({
    source: 'linked:test/completion-context',
    packageJson: {
      name: 'test-completion-context',
      version: '1.0.0',
      license: 'MIT',
      type: 'module',
      description: 'Completion context contract fixture',
      modkit: {
        schemaVersion: 1,
        publisher: 'org.modkit.test',
        id: 'completion-context',
        contributionManifests: ['./contributions/language.json'],
      },
    },
    contributions: [
      {
        path: 'contributions/language.json',
        manifest: {
          schemaVersion: 1,
          contract: { id: 'org.modkitx/service-provider-contribution', major: 1 },
          id: 'org.modkit.test/completion-context-provider',
          displayName: 'Completion context',
          runtimeVariants: [
            {
              variantId: 'trusted-node',
              entrypoint: './provider.js',
              target: { environments: ['node'] },
              executionProfile: 'trusted-in-process',
              requestedPermissionClasses: [],
            },
          ],
          spec: {
            lifecycleScope: 'session',
            provides: [
              {
                offerId: 'completion',
                contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
                major: 1,
                version: '1.0.0',
                facet: { languageIds: ['fixture'] },
              },
            ],
          },
        },
      },
    ],
    modules: {
      './provider.js': {
        abiVersion: 1,
        provides: [LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT],
        createProvider: () => ({ value: provider, release: async () => undefined }),
      },
    },
  })
  const linked = linkedExtensionInputs([extension])
  const composition = await createHostComposition({
    topology: createHostTopology({
      schemaVersion: 1,
      topologyId: 'org.modkit.test/context',
      realms: [
        {
          schemaVersion: 1,
          realmId: 'org.modkit.test/context',
          revision: '1',
          target: { environment: 'node', operatingSystem: 'linux', architecture: 'x64' },
          facilities: [],
          budgets: {
            maxConcurrentTasks: 2,
            maxWorkerCount: 0,
          maxResidentBytes: uint64('134217728'),
          maxTransferBytes: uint64('134217728'),
            defaultDeadlineMs: 10000,
          },
          policy: { id: 'org.modkit.test/context-policy', revision: '1' },
        },
      ],
      links: [],
    }),
    realmId: 'org.modkit.test/context',
    extensions: linked.inputs,
    executionBackends: createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)]),
  })
  const definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
  const snapshot = vi.fn<LanguageWorkspaceDocumentSource['snapshot']>(async () => ({
    documents: [],
    isComplete: true,
  }))
  const workspace = createLanguageWorkspace({
    services: { ...composition, serviceDefinitions: definitions },
    grant: { id: 'completion-context-test', classes: [] },
    budgets: {
      maxInputBytes: 1000000n,
      maxDepth: 64,
      maxNodes: 100000,
      maxScalarBytes: 1000000,
      maxDiagnostics: 100,
    },
    documentSource: { snapshot },
  })
  await workspace.initialize()
  const document = { uri: 'memory://test.fixture', languageId: 'fixture', version: 1, text: '<' }
  expect((await workspace.synchronize({ languageId: 'fixture', document })).state).toBe('resolved')
  const request = { uri: document.uri, documentVersion: 1, position: { line: 0, character: 1 } }
  return { workspace, snapshot, completion, request, document }
}

it('skips the dependency source only for explicitly independent cached completion', async () => {
  const selector = vi.fn(async () => 'document' as const)
  const f = await fixture(selector)
  try {
    await f.workspace.completion({ ...f.request, semanticContextPolicy: 'cached' })
    expect(f.snapshot).not.toHaveBeenCalled()
    expect(selector).toHaveBeenCalledOnce()
    await f.workspace.completion({ ...f.request, semanticContextPolicy: 'fresh' })
    expect(f.snapshot).toHaveBeenCalledOnce()
    expect(selector).toHaveBeenCalledOnce()
  } finally {
    await f.workspace.shutdown()
  }
})

it.each([undefined, async () => 'workspace' as const])(
  'keeps the source for legacy and workspace-dependent providers',
  async selector => {
    const f = await fixture(selector)
    try {
      await f.workspace.completion({ ...f.request, semanticContextPolicy: 'cached' })
      expect(f.snapshot).toHaveBeenCalledOnce()
    } finally {
      await f.workspace.shutdown()
    }
  },
)

it('rejects an invalid context mode before calling completion', async () => {
  const f = await fixture(async () => 'invalid' as 'document')
  try {
    await expect(
      f.workspace.completion({ ...f.request, semanticContextPolicy: 'cached' }),
    ).rejects.toThrow(/invalid completion context mode/u)
    expect(f.snapshot).not.toHaveBeenCalled()
    expect(f.completion).not.toHaveBeenCalled()
  } finally {
    await f.workspace.shutdown()
  }
})

it('cancels context selection when a newer document supersedes the request', async () => {
  let entered = (): void => undefined
  const gate = new Promise<void>(resolve => {
    entered = resolve
  })
  const f = await fixture(async request => {
    entered()
    await new Promise<void>(resolve =>
      request.signal?.addEventListener('abort', () => resolve(), { once: true }),
    )
    return 'document'
  })
  try {
    const pending = f.workspace.completion({ ...f.request, semanticContextPolicy: 'cached' })
    const caught = expect(pending).rejects.toBeInstanceOf(OperationCancelledError)
    await gate
    await f.workspace.synchronize({
      languageId: 'fixture',
      document: { ...f.document, version: 2, text: '<f' },
    })
    await caught
    expect(f.completion).not.toHaveBeenCalled()
  } finally {
    await f.workspace.shutdown()
  }
})
