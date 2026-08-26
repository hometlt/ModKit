import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { OperationCancelledError, uint64 } from '@modkitx-x3/core'
import { createHostTopology } from '@modkitx-x3/sdk'
import type { LanguageAnalysis, LanguageDocument } from '@modkitx-x3/sdk/language'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type HostComposition,
  type LinkedExtension,
  type LinkedModule,
} from '@modkitx-x3/host'
import {
  createLanguageWorkspace,
  languageProviderRoutes,
  LANGUAGE_ANALYSIS_INVALID,
  LANGUAGE_DOCUMENT_CHANGE_INVALID,
  LANGUAGE_PROVIDER_FAILED,
  LANGUAGE_WORKSPACE_SHUT_DOWN,
  resolveLanguageProvider,
  type LanguageHostServices,
  type LanguageWorkspaceDocumentRequest,
} from '@modkitx-x3/host/language'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { galaxyLanguage } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'galaxy-language', 'src', 'linked.js'))
    .href
)) as { readonly galaxyLanguage: LinkedExtension }
const { analyzeGalaxy } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'galaxy-language', 'src', 'provider.js'))
    .href
)) as {
  readonly analyzeGalaxy: (request: {
    readonly document: LanguageDocument
    readonly signal?: AbortSignal
  }) => Promise<LanguageAnalysis>
}

const REALM = 'org.modkitx.test/language-host'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/language',
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
      policy: { id: 'org.modkitx.test/language-policy', revision: '1' },
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

let composition: HostComposition
let definitions: ReturnType<typeof createBundledServiceDefinitionRegistry>

beforeAll(async () => {
  const linked = linkedExtensionInputs([galaxyLanguage])
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

async function galaxy(text: string): Promise<LanguageAnalysis> {
  const resolution = await resolveLanguageProvider({
    services: { ...composition, serviceDefinitions: definitions },
    languageId: 'galaxy',
    documentKind: 'galaxy-source',
    extension: '.galaxy',
    grant: { id: 'language-test', classes: [] },
    budgets,
  })
  expect(resolution.state).toBe('resolved')
  if (resolution.state !== 'resolved') throw new Error('Galaxy provider did not resolve')
  const document: LanguageDocument = {
    uri: 'file:///TriggerLibs/Waves.galaxy',
    languageId: 'galaxy',
    version: 7,
    text,
  }
  try {
    return await resolution.provider.analyze({ document })
  } finally {
    await resolution.release()
  }
}

const languageRequest = (
  version: number,
  text = 'void Test() {}',
): LanguageWorkspaceDocumentRequest => ({
  languageId: 'galaxy',
  documentKind: 'galaxy-source',
  extension: 'galaxy',
  document: {
    uri: 'file:///TriggerLibs/Test.galaxy',
    languageId: 'galaxy',
    version,
    text,
  },
})

const analysisFor = (request: { readonly document: LanguageDocument }): LanguageAnalysis => ({
  documentUri: request.document.uri,
  documentVersion: request.document.version,
  tokens: [],
  diagnostics: [],
  symbols: [],
})

async function controlledLanguageServices(module: LinkedModule): Promise<LanguageHostServices> {
  const entry = galaxyLanguage.moduleEntries[0]
  if (entry === undefined) throw new Error('Galaxy linked fixture has no provider entrypoint')
  const controlled: LinkedExtension = Object.freeze({
    ...galaxyLanguage,
    moduleEntries: Object.freeze([[entry[0], module] as const]),
  })
  const linked = linkedExtensionInputs([controlled])
  const executionBackends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  const controlledComposition = await createHostComposition({
    topology,
    realmId: REALM,
    extensions: linked.inputs,
    executionBackends,
  })
  const controlledDefinitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(controlledComposition.inventory, controlledDefinitions)
  return { ...controlledComposition, serviceDefinitions: controlledDefinitions }
}

const providerModule = (
  provider: Readonly<Record<string, unknown>>,
  release: () => void = () => undefined,
): LinkedModule => ({
  abiVersion: 1,
  provides: ['common.language/document-analysis'],
  createProvider: () => ({ value: provider, release: async () => release() }),
})

describe('standard language contract and Galaxy provider', () => {
  it('projects configured routes deterministically and deduplicates runtime variants', () => {
    expect(languageProviderRoutes(composition.inventory)).toEqual([
      { languageId: 'galaxy', documentKind: 'galaxy-source', extension: 'ai' },
      { languageId: 'galaxy', documentKind: 'galaxy-source', extension: 'galaxy' },
    ])
    expect(Object.isFrozen(languageProviderRoutes(composition.inventory))).toBe(true)
  })

  it('resolves a declared route and returns tokens, diagnostics and document symbols', async () => {
    const result = await galaxy(
      [
        'struct WaveState {',
        '  int count;',
        '};',
        '',
        'void SpawnWave(int count) {',
        '  string label = "wave";',
        '  // Spawn only a positive wave.',
        '  if (count > 0) {',
        '    return;',
        '  }',
        '}',
      ].join('\n'),
    )

    expect(result.documentVersion).toBe(7)
    expect(result.diagnostics).toEqual([])
    expect(result.tokens.map(item => item.kind)).toEqual(
      expect.arrayContaining(['comment', 'keyword', 'number', 'string', 'type']),
    )
    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'WaveState', kind: 'struct' }),
        expect.objectContaining({ name: 'SpawnWave', kind: 'function' }),
      ]),
    )
  })

  it('reports a protocol-neutral diagnostic for malformed Galaxy source', async () => {
    const result = await galaxy('void Broken() {\n  return;\n')
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'galaxy/unclosed-brace', severity: 'error' }),
    ])
  })

  it('keeps CRLF token and symbol coordinates inside native UTF-16 line bounds', async () => {
    const workspace = createLanguageWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'galaxy-crlf-workspace', classes: [] },
      budgets,
    })
    await workspace.initialize()
    const result = await workspace.open({
      ...languageRequest(1, '// hello\r\nvoid Test() {\r\n  return;\r\n}\r\n'),
      document: {
        ...languageRequest(1).document,
        text: '// hello\r\nvoid Test() {\r\n  return;\r\n}\r\n',
      },
    })
    expect(result).toMatchObject({ state: 'resolved' })
    if (result.state === 'resolved') {
      expect(result.analysis.tokens).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'comment' })]),
      )
      expect(result.analysis.symbols).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Test' })]),
      )
    }
    await workspace.shutdown()
  })

  it('yields during a large Galaxy scan so a worker cancellation can interrupt it', async () => {
    const controller = new AbortController()
    queueMicrotask(() => controller.abort('cancel the large scan'))
    await expect(
      analyzeGalaxy({
        document: {
          uri: 'file:///TriggerLibs/Large.galaxy',
          languageId: 'galaxy',
          version: 1,
          text: ' '.repeat(128 * 1024),
        },
        signal: controller.signal,
      }),
    ).rejects.toBe('cancel the large scan')
    expect(controller.signal.aborted).toBe(true)
  })

  it('does not select the Galaxy offer for another language route', async () => {
    const resolution = await resolveLanguageProvider({
      services: { ...composition, serviceDefinitions: definitions },
      languageId: 'xml',
      documentKind: 'xml-source',
      extension: 'xml',
      grant: { id: 'language-test-mismatch', classes: [] },
      budgets,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/language-provider-unresolved',
    )
  })
})

describe('language workspace lifecycle', () => {
  it('initializes idempotently, keeps one lease across changes, and releases it exactly once', async () => {
    let releases = 0
    const services = await controlledLanguageServices(
      providerModule(
        {
          contract: 'common.language/document-analysis',
          languageIds: ['galaxy'],
          analyze: (request: { readonly document: LanguageDocument }) =>
            Promise.resolve(analysisFor(request)),
        },
        () => {
          releases += 1
        },
      ),
    )
    const workspace = createLanguageWorkspace({
      services,
      grant: { id: 'workspace-lifecycle', classes: [] },
      budgets,
    })
    await workspace.initialize()
    await workspace.initialize()
    expect((await workspace.open(languageRequest(1))).state).toBe('resolved')
    expect((await workspace.change(languageRequest(2))).state).toBe('resolved')
    expect((await workspace.current('file:///TriggerLibs/Test.galaxy'))?.state).toBe('resolved')
    await workspace.close('file:///TriggerLibs/Test.galaxy')
    await workspace.close('file:///TriggerLibs/Test.galaxy')
    await workspace.shutdown()
    await workspace.shutdown()
    expect(releases).toBe(1)
    await expect(workspace.initialize()).rejects.toMatchObject({
      code: LANGUAGE_WORKSPACE_SHUT_DOWN,
    })
  })

  it('requires an open URI, unchanged route/language, and a strictly increasing version', async () => {
    const services = await controlledLanguageServices(
      providerModule({
        contract: 'common.language/document-analysis',
        languageIds: ['galaxy'],
        analyze: (request: { readonly document: LanguageDocument }) =>
          Promise.resolve(analysisFor(request)),
      }),
    )
    const workspace = createLanguageWorkspace({
      services,
      grant: { id: 'workspace-versioning', classes: [] },
      budgets,
    })
    await workspace.initialize()
    await expect(workspace.change(languageRequest(1))).rejects.toMatchObject({
      code: 'x3.host/language-document-not-open',
    })
    await workspace.open(languageRequest(2))
    await expect(workspace.change(languageRequest(2))).rejects.toMatchObject({
      code: LANGUAGE_DOCUMENT_CHANGE_INVALID,
    })
    await expect(
      workspace.change({
        ...languageRequest(3),
        extension: 'ai',
      }),
    ).rejects.toMatchObject({ code: LANGUAGE_DOCUMENT_CHANGE_INVALID })
    await workspace.shutdown()
  })

  it('aborts stale work even when the provider returns after ignoring cancellation', async () => {
    let finishVersionTwo: (() => void) | undefined
    const services = await controlledLanguageServices(
      providerModule({
        contract: 'common.language/document-analysis',
        languageIds: ['galaxy'],
        analyze: (request: { readonly document: LanguageDocument }) => {
          if (request.document.version !== 2) return Promise.resolve(analysisFor(request))
          return new Promise<LanguageAnalysis>(resolve => {
            finishVersionTwo = () => resolve(analysisFor(request))
          })
        },
      }),
    )
    const workspace = createLanguageWorkspace({
      services,
      grant: { id: 'workspace-stale', classes: [] },
      budgets,
    })
    await workspace.initialize()
    await workspace.open(languageRequest(1))
    const stale = workspace.change(languageRequest(2))
    const current = workspace.change(languageRequest(3))
    await expect(current).resolves.toMatchObject({
      state: 'resolved',
      analysis: { documentVersion: 3 },
    })
    finishVersionTwo?.()
    await expect(stale).rejects.toBeInstanceOf(OperationCancelledError)
    await expect(workspace.current('file:///TriggerLibs/Test.galaxy')).resolves.toMatchObject({
      state: 'resolved',
      analysis: { documentVersion: 3 },
    })
    await workspace.shutdown()
  })

  it('preserves cancellation at the post-resolution boundary and releases the lease once', async () => {
    const controller = new AbortController()
    let releases = 0
    const provider = {
      contract: 'common.language/document-analysis',
      get languageIds(): readonly string[] {
        controller.abort('cancelled after activation')
        return ['galaxy']
      },
      analyze: (request: { readonly document: LanguageDocument }) =>
        Promise.resolve(analysisFor(request)),
    }
    const services = await controlledLanguageServices(
      providerModule(provider, () => {
        releases += 1
      }),
    )
    const workspace = createLanguageWorkspace({
      services,
      grant: { id: 'workspace-boundary-cancel', classes: [] },
      budgets,
    })
    await workspace.initialize()
    await expect(
      workspace.open({ ...languageRequest(1), signal: controller.signal }),
    ).rejects.toBeInstanceOf(OperationCancelledError)
    await workspace.shutdown()
    expect(releases).toBe(1)
  })

  it('distinguishes provider exceptions from invalid provider results and can reopen', async () => {
    let calls = 0
    let releases = 0
    const services = await controlledLanguageServices(
      providerModule(
        {
          contract: 'common.language/document-analysis',
          languageIds: ['galaxy'],
          analyze: (request: { readonly document: LanguageDocument }) => {
            calls += 1
            if (calls === 1) throw new Error('fixture provider crash')
            if (calls === 2) {
              return Promise.resolve({
                ...analysisFor(request),
                documentUri: 'file:///wrong.galaxy',
              })
            }
            if (calls === 3) {
              return Promise.resolve({
                ...analysisFor(request),
                tokens: [
                  {
                    kind: 'provider-private-token',
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 1 },
                    },
                  },
                ],
              })
            }
            if (calls === 4) {
              return Promise.resolve({
                ...analysisFor(request),
                symbols: [
                  {
                    name: 'Bad',
                    kind: 'provider-private-symbol',
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 1 },
                    },
                    selectionRange: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 1 },
                    },
                  },
                ],
              })
            }
            if (calls === 5) {
              return Promise.resolve({
                ...analysisFor(request),
                tokens: [{ kind: 'string' }],
              })
            }
            return Promise.resolve(analysisFor(request))
          },
        },
        () => {
          releases += 1
        },
      ),
    )
    const workspace = createLanguageWorkspace({
      services,
      grant: { id: 'workspace-recovery', classes: [] },
      budgets,
    })
    await workspace.initialize()
    await expect(workspace.open(languageRequest(1))).rejects.toMatchObject({
      code: LANGUAGE_PROVIDER_FAILED,
    })
    await expect(workspace.open(languageRequest(2))).rejects.toMatchObject({
      code: LANGUAGE_ANALYSIS_INVALID,
    })
    await expect(workspace.open(languageRequest(3))).rejects.toMatchObject({
      code: LANGUAGE_ANALYSIS_INVALID,
    })
    await expect(workspace.open(languageRequest(4))).rejects.toMatchObject({
      code: LANGUAGE_ANALYSIS_INVALID,
    })
    await expect(workspace.open(languageRequest(5))).rejects.toMatchObject({
      code: LANGUAGE_ANALYSIS_INVALID,
    })
    await expect(workspace.open(languageRequest(6))).resolves.toMatchObject({ state: 'resolved' })
    await workspace.shutdown()
    expect(releases).toBe(6)
  })
})
