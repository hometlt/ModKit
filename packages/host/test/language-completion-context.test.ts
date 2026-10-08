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
  LANGUAGE_DOCUMENT_CONTRACT_DEFINITION,
  type LanguageWorkspaceDocumentSource,
} from '../src/language/index.js'
import { composeLanguageDocumentSources } from '../src/content-dependency-operations.js'

/** Activate a public language provider with a controllable source and observed feature requests. */
async function fixture(
  selector?: LanguageProvider['completionContext'],
  analysis?: LanguageProvider['analyze'],
  localFeatures?: LanguageProvider['documentLocalFeatures'],
) {
  const completion = vi.fn<NonNullable<LanguageProvider['completion']>>(async () => ({
    items: [{ label: 'schema-field', kind: 'field' as const }],
    isIncomplete: false,
  }))
  const provider: LanguageProvider = {
    contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
    languageIds: ['fixture'],
    analyze:
      analysis ??
      (async ({ document }) => ({
        documentUri: document.uri,
        documentVersion: document.version,
        tokens: [],
        diagnostics: [],
        symbols: [],
      })),
    completion,
    documentSymbols: vi.fn(async () => ({ symbols: [], isIncomplete: false })),
    foldingRanges: vi.fn(async () => ({ ranges: [], isIncomplete: false })),
    formatting: vi.fn(async () => ({ edits: [], isComplete: true as const })),
    ...(localFeatures === undefined ? {} : { documentLocalFeatures: localFeatures }),
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
  return { workspace, snapshot, completion, request, document, provider }
}

it.each(['documentSymbols', 'foldingRanges', 'formatting'] as const)(
  'reads only the live document for opted-in %s, keeping workspace features fresh',
  async feature => {
    const f = await fixture(undefined, undefined, [feature])
    try {
      await f.workspace.synchronize({
        languageId: 'fixture',
        document: { ...f.document, uri: 'memory://other.fixture', text: 'other mod' },
      })
      if (feature === 'formatting') {
        await f.workspace.formatting({ ...f.request, options: { tabSize: 2, insertSpaces: true } })
      } else await f.workspace[feature](f.request)
      expect(f.snapshot).not.toHaveBeenCalled()
      const request = vi.mocked(f.provider[feature]!).mock.calls[0]![0]
      expect(request.workspaceDocuments).toEqual([f.document])
      expect(request.workspaceContext?.semanticComplete).toBe(false)
      expect(request.workspaceContext?.modContext).toBeUndefined()
      await f.workspace.completion(f.request)
      expect(f.snapshot).toHaveBeenCalledTimes(1)
      expect(f.completion.mock.calls[0]![0].workspaceDocuments).toHaveLength(2)
    } finally {
      await f.workspace.shutdown()
    }
  },
)

it('keeps the full source for a provider without a document-local declaration', async () => {
  const f = await fixture()
  try {
    await f.workspace.documentSymbols(f.request)
    expect(f.snapshot).toHaveBeenCalledTimes(1)
  } finally {
    await f.workspace.shutdown()
  }
})

it('advertises the document-local declaration across the provider execution boundary', () => {
  expect(LANGUAGE_DOCUMENT_CONTRACT_DEFINITION.surface?.fields).toContain('documentLocalFeatures')
})

it('scopes a feature to its mod and edited dependency while other open mods stay loaded', async () => {
  const test = await fixture()
  const dependency = {
    ...test.document,
    uri: 'memory://dependency.fixture',
    text: 'unsaved dependency',
  }
  const foreign = {
    ...test.document,
    uri: 'memory://other-mod.fixture',
    text: 'broken unrelated document',
  }
  const origin = (uri: string, layerId: string, readOnly: boolean) => ({
    uri,
    layerId,
    logicalId: 'file.fixture',
    precedence: readOnly ? 0 : 1,
    sourceRevision: 'revision:1',
    readOnly,
  })
  await test.workspace.synchronize({ languageId: 'fixture', document: dependency })
  await test.workspace.synchronize({ languageId: 'fixture', document: foreign })
  const scoped = composeLanguageDocumentSources(
    [origin(dependency.uri, 'base', true), origin(test.document.uri, 'mod', false)].map(item => ({
      async snapshot() {
        return {
          documents: [],
          isComplete: true,
          scopeWorkspaceDocuments: true,
          workspaceContext: {
            id: item.layerId,
            revision: '1',
            semanticComplete: true,
            documentOrigins: [item],
          },
        }
      },
    })),
  )
  if (scoped === undefined) throw new Error('composed scope was not created')
  test.snapshot.mockImplementation(scoped.snapshot)
  try {
    await test.workspace.completion(test.request)
    const request = test.completion.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('completion request was not observed')
    expect(request.workspaceDocuments).toEqual([dependency, test.document])
    expect(request.workspaceContext?.semanticComplete).toBe(true)
    expect(request.workspaceContext?.documentOrigins.map(item => item.uri)).not.toContain(
      foreign.uri,
    )
    // Scope is per feature; it does not close or discard another mod's open document.
    await test.workspace.completion({ ...test.request, uri: foreign.uri })
    expect(test.completion.mock.calls[1]?.[0].document).toEqual(foreign)
    expect(test.completion.mock.calls[1]?.[0].workspaceContext?.semanticComplete).toBe(false)
    // Legacy sources that do not opt into scope retain their editor workspace.
    test.snapshot.mockResolvedValue({ documents: [], isComplete: true })
    await test.workspace.completion(test.request)
    expect(test.completion.mock.calls[2]?.[0].workspaceDocuments).toContainEqual(foreign)
  } finally {
    await test.workspace.shutdown()
  }
})

it('rejects a scoped source without context authority', async () => {
  const test = await fixture()
  test.snapshot.mockResolvedValue({
    documents: [],
    isComplete: true,
    scopeWorkspaceDocuments: true,
  })
  try {
    await expect(test.workspace.completion(test.request)).rejects.toThrow(/invalid snapshot/u)
    expect(test.completion).not.toHaveBeenCalled()
  } finally {
    await test.workspace.shutdown()
  }
})

it('retains captured source documents while revalidating text, metadata and source authority', async () => {
  const f = await fixture()
  const closed = {
    uri: 'memory://closed.fixture',
    languageId: 'fixture',
    version: 1,
    text: 'before',
    dialect: 'one',
  }
  let revision = '1',
    complete = true,
    present = true
  f.snapshot.mockImplementation(async () => ({
    documents: present ? [{ ...closed }] : [],
    isComplete: complete,
    workspaceContext: {
      id: 'fixture-source',
      revision,
      semanticComplete: complete,
      documentOrigins: [
        {
          uri: f.document.uri,
          layerId: 'root',
          logicalId: 'test.fixture',
          precedence: 0,
          sourceRevision: revision,
          readOnly: false,
        },
        ...(present
          ? [
              {
                uri: closed.uri,
                layerId: 'root',
                logicalId: 'closed.fixture',
                precedence: 0,
                sourceRevision: revision,
                readOnly: true,
              },
            ]
          : []),
      ],
      semanticInputs: [],
    },
  }))
  /** Read the exact immutable source document that reached the provider. */
  const captured = (call: number) =>
    f.completion.mock.calls[call]?.[0].workspaceDocuments.find(
      document => document.uri === closed.uri,
    )
  try {
    await f.workspace.completion(f.request)
    const first = captured(0)
    expect(first).not.toBe(closed)
    expect(Object.isFrozen(first)).toBe(true)
    await f.workspace.completion(f.request)
    expect(captured(1)).toBe(first)
    expect(f.snapshot).toHaveBeenCalledTimes(2)

    closed.text = 'after!'
    await f.workspace.completion(f.request)
    expect(captured(2)).not.toBe(first)
    expect(captured(2)?.text).toBe('after!')
    expect(first?.text).toBe('before')
    closed.dialect = 'two'
    await f.workspace.completion(f.request)
    expect(captured(3)).not.toBe(captured(2))
    expect(captured(3)?.dialect).toBe('two')

    revision = '2'
    complete = false
    await f.workspace.completion(f.request)
    expect(captured(4)).toBe(captured(3))
    expect(f.completion.mock.calls[4]?.[0].workspaceContext?.revision).not.toBe(
      f.completion.mock.calls[3]?.[0].workspaceContext?.revision,
    )
    expect(f.completion.mock.calls[4]?.[0].workspaceContext?.semanticComplete).toBe(false)
    expect(
      f.completion.mock.calls[4]?.[0].workspaceContext?.documentOrigins.every(
        origin => origin.sourceRevision === revision,
      ),
    ).toBe(true)

    closed.version = 2
    await f.workspace.completion(f.request)
    expect(captured(5)).not.toBe(captured(4))
    expect(captured(5)?.version).toBe(2)
    present = false
    await f.workspace.completion(f.request)
    expect(captured(6)).toBeUndefined()
    present = true
    await f.workspace.completion(f.request)
    expect(captured(7)).not.toBe(captured(5))
    expect(captured(7)?.text).toBe(closed.text)
    expect(f.snapshot).toHaveBeenCalledTimes(8)
  } finally {
    await f.workspace.shutdown()
  }
})

it('forwards full documents even when their conservative retention cost exceeds the workspace budget', async () => {
  const f = await fixture()
  const closed = {
    uri: 'memory://large.fixture',
    languageId: 'fixture',
    version: 1,
    text: 'x'.repeat(400000),
  }
  f.snapshot.mockImplementation(async () => ({ documents: [{ ...closed }], isComplete: true }))
  try {
    await f.workspace.completion(f.request)
    await f.workspace.completion(f.request)
    const first = f.completion.mock.calls[0]?.[0].workspaceDocuments.find(
      document => document.uri === closed.uri,
    )
    const second = f.completion.mock.calls[1]?.[0].workspaceDocuments.find(
      document => document.uri === closed.uri,
    )
    expect(first).not.toBe(second)
    expect(first?.text).toBe(closed.text)
    expect(second?.text).toBe(closed.text)
    expect(f.snapshot).toHaveBeenCalledTimes(2)
  } finally {
    await f.workspace.shutdown()
  }
})

it('returns activated capabilities without waiting for background analysis', async () => {
  let release = (): void => undefined
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const f = await fixture(undefined, async ({ document }) => {
    await gate
    return {
      documentUri: document.uri,
      documentVersion: document.version,
      tokens: [],
      diagnostics: [],
      symbols: [],
    }
  })
  const analysis = f.workspace.analyze({ languageId: 'fixture', document: f.document })
  try {
    const capabilities = f.workspace.capabilities(f.document.uri)
    const result = await Promise.race([
      capabilities,
      new Promise<'blocked'>(resolve => setImmediate(() => resolve('blocked'))),
    ])
    expect(result).toMatchObject({
      documentVersion: 1,
      features: expect.arrayContaining(['completion']),
    })
    expect(f.completion).not.toHaveBeenCalled()
  } finally {
    release()
    await analysis
    await f.workspace.shutdown()
  }
}, 15_000)

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
