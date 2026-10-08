import { beforeAll, describe, expect, it, vi } from 'vitest'
import { OperationCancelledError, uint64 } from '@modkit/core'
import {
  createHostTopology,
  type SubjectCandidateProvider,
  type SubjectCandidateProviderSource,
} from '@modkit/sdk'
import type {
  LanguageAnalysis,
  LanguageDiagnosticList,
  LanguageDocument,
  LanguageProvider,
  LanguageWorkspaceContext,
  LanguageWorkspaceDocumentOrigin,
  LanguageWorkspaceSemanticInput,
} from '@modkit/sdk/language'
import { LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT } from '@modkit/sdk/language'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  defineLinkedExtension,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
} from '@modkit/host'
import {
  createLanguageWorkspace,
  languageProviderRoutes,
  languageProviderTriggerCharacters,
  LANGUAGE_DOCUMENT_CONTRACT_DEFINITION,
  LANGUAGE_EDIT_READ_ONLY,
  type LanguageHostServices,
  type LanguageWorkspaceDocumentSource,
  type LanguageWorkspaceDocumentRequest,
} from '../src/language/index.js'

describe('standard language execution surface', () => {
  it('carries colour methods across in-process and worker boundaries', () => {
    expect(LANGUAGE_DOCUMENT_CONTRACT_DEFINITION.surface?.fields).toContain(
      'semanticContextRequirements',
    )
    expect(LANGUAGE_DOCUMENT_CONTRACT_DEFINITION.surface?.methods).toMatchObject({
      documentColors: { kind: 'value', optional: true },
      colorPresentations: { kind: 'value', optional: true },
      onTypeFormatting: { kind: 'value', optional: true },
    })
  })
})

const REALM = 'org.modkit.test/subject-completion-host'
const DOCUMENT_URI = 'file:///workspace/fixture.lang'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkit.test/subject-completion',
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
      policy: { id: 'org.modkit.test/subject-completion-policy', revision: '1' },
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

const analysisFor = (document: LanguageDocument): LanguageAnalysis => ({
  documentUri: document.uri,
  documentVersion: document.version,
  tokens: [],
  diagnostics: [],
  symbols: [],
})

let observedWorkspaceIncomplete: boolean | undefined
let observedWorkspaceDocuments: readonly string[] = []
let observedWorkspaceContext: LanguageWorkspaceContext | undefined

const provider: LanguageProvider = {
  contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  languageIds: ['fixture-language'],
  workspaceLanguageIds: ['fixture-language', 'fixture-localization'],
  semanticInputs: [{ kind: 'schema', id: 'fixture/schema@1', revision: 'fixture-schema:1' }],
  analyze: request => Promise.resolve(analysisFor(request.document)),
  completion: request => {
    observedWorkspaceIncomplete = request.workspaceIncomplete
    observedWorkspaceDocuments = request.workspaceDocuments.map(document => document.uri)
    observedWorkspaceContext = request.workspaceContext
    return Promise.resolve({
      items: [
        {
          label: 'expanded',
          kind: 'snippet',
          insertText: '<Expanded>$0</Expanded>',
          insertTextFormat: 'snippet',
          filterText: '<expanded',
          replacementRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
        {
          kind: 'subject-ref',
          subjectKind: 'unit',
          filter: { excludeTags: ['default'] },
        },
      ],
      isIncomplete: false,
    })
  },
  onTypeFormatting: request =>
    Promise.resolve({
      edits: [{ range: { start: request.position, end: request.position }, newText: '""' }],
      isComplete: true,
      cursor: { line: request.position.line, character: request.position.character + 1 },
      requestCompletion: true,
    }),
  definition: request =>
    Promise.resolve({
      locations: request.workspaceDocuments
        .filter(document => document.uri.endsWith('/dependency.lang'))
        .map(document => ({
          uri: document.uri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: Math.min(10, document.text.length) },
          },
        })),
      isIncomplete: request.workspaceIncomplete,
    }),
  references: request =>
    Promise.resolve({
      locations: request.workspaceDocuments
        .filter(document => document.uri.endsWith('/dependency.lang'))
        .map(document => ({
          uri: document.uri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: Math.min(10, document.text.length) },
          },
        })),
      isIncomplete: request.workspaceIncomplete,
    }),
  referenceOccurrences: request => {
    if (!request.document.text.startsWith('indexed-') || request.workspaceContext === undefined)
      return Promise.resolve([])
    const origin = request.workspaceContext.documentOrigins.find(
      item => item.uri === request.document.uri,
    )
    if (origin === undefined) return Promise.resolve([])
    return Promise.resolve([
      {
        contextId: request.workspaceContext.id,
        contextRevision: request.workspaceContext.revision,
        semanticComplete: request.workspaceContext.semanticComplete,
        sourceUri: request.document.uri,
        sourceRevision: origin.sourceRevision,
        occurrences: [
          {
            target: {
              owner: 'org.modkit.test/subject-completion-language-provider',
              kind: 'cross-language-symbol',
              id: 'dependency',
              workspace: request.workspaceContext.id,
            },
            source: {
              uri: request.document.uri,
              sourceRevision: origin.sourceRevision,
              span: { utf16Offset: 0, utf16Length: 11, line: 0, column: 0 },
              origin,
            },
            semanticPath: ['dependency'],
            role: request.document.text.startsWith('indexed-declaration')
              ? 'declaration'
              : 'reference',
            form: 'literal',
            provenance: 'org.modkit.test/subject-completion-language-provider',
            ...(request.document.text.startsWith('indexed-declaration')
              ? {
                  subject: {
                    workspace: request.workspaceContext.id,
                    source: { id: request.document.uri },
                    identity: { kind: 'fixture/cross-language-symbol', key: 'dependency' },
                  },
                }
              : {}),
          },
        ],
      },
    ])
  },
  rename: request =>
    Promise.resolve({
      isComplete: true,
      documentChanges: [
        {
          uri: request.document.uri,
          documentVersion: request.document.version,
          edits: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
              newText: request.newName,
            },
          ],
        },
        ...request.workspaceDocuments
          .filter(document => document.uri !== request.document.uri)
          .map(document => ({
            uri: document.uri,
            documentVersion: document.version,
            edits: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: Math.min(5, document.text.length) },
                },
                newText: request.newName,
              },
            ],
          })),
      ],
    }),
  codeActions: request =>
    Promise.resolve({
      actions: [
        {
          title: 'Replace fixture token',
          kind: 'quickfix',
          isPreferred: true,
          diagnosticCodes: request.diagnostics.flatMap(item =>
            item.code === undefined ? [] : [item.code],
          ),
          edit: {
            isComplete: true,
            documentChanges: [
              {
                uri: request.document.uri,
                documentVersion: request.document.version,
                edits: [{ range: request.range, newText: 'fixed' }],
              },
            ],
          },
        },
      ],
      isIncomplete: false,
    }),
}

const fixture = defineLinkedExtension({
  source: 'linked:test/subject-completion-language',
  packageJson: {
    name: 'modkit-test-subject-completion-language',
    version: '1.0.0',
    license: 'MIT',
    type: 'module',
    description: 'Neutral language provider for subject completion host tests.',
    modkit: {
      schemaVersion: 1,
      publisher: 'org.modkit.test',
      id: 'subject-completion-language',
      contributionManifests: ['./contributions/language.json'],
    },
  },
  contributions: [
    {
      path: 'contributions/language.json',
      manifest: {
        schemaVersion: 1,
        contract: { id: 'org.modkitx/service-provider-contribution', major: 1 },
        id: 'org.modkit.test/subject-completion-language-provider',
        displayName: 'Subject completion language provider',
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
              offerId: 'fixture-language-v1',
              contract: 'common.language/document-analysis',
              major: 1,
              version: '1.0.0',
              facet: {
                languageIds: ['fixture-language'],
                documentKinds: ['fixture-source'],
                extensions: ['lang'],
                completionTriggerCharacters: ['<', ' '],
                signatureHelpTriggerCharacters: ['(', ','],
                onTypeFormattingTriggerCharacters: ['='],
              },
            },
          ],
          lifecycleScope: 'session',
        },
      },
    },
  ],
  modules: {
    './src/provider.js': {
      abiVersion: 1,
      provides: ['common.language/document-analysis'],
      createProvider: (_selection: unknown, context?: { readonly settings?: unknown }) => {
        providerSettings = context?.settings
        return { value: providerFactory(), release: async () => undefined }
      },
    },
  },
})

let services: LanguageHostServices
let providerSettings: unknown
let providerFactory = (): LanguageProvider => provider

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

it('hands a language provider the host settings for it, as a codec gets them', async () => {
  const settings = { values: { hintDetail: 'full' } }
  const workspace = createLanguageWorkspace({
    services: { ...services, contributionSettings: () => settings },
    grant: { id: 'provider-settings-test', classes: [] },
    budgets,
  })
  await workspace.initialize()
  try {
    expect((await workspace.open(languageRequest(1))).state).toBe('resolved')
    expect(providerSettings).toEqual(settings)
  } finally {
    await workspace.shutdown()
  }
})

it('projects provider-owned trigger characters with the language route', () => {
  const routes = languageProviderRoutes(services.inventory)
  expect(routes).toEqual([
    {
      languageId: 'fixture-language',
      documentKind: 'fixture-source',
      extension: 'lang',
      completionTriggerCharacters: [' ', '<'],
      signatureHelpTriggerCharacters: ['(', ','],
      onTypeFormattingTriggerCharacters: ['='],
    },
  ])
  expect(languageProviderTriggerCharacters(routes, 'completion')).toEqual([' ', '<'])
  expect(languageProviderTriggerCharacters(routes, 'signatureHelp')).toEqual(['(', ','])
  expect(languageProviderTriggerCharacters(routes, 'onTypeFormatting')).toEqual(['='])
})

const languageRequest = (version: number, text = 'value'): LanguageWorkspaceDocumentRequest => ({
  languageId: 'fixture-language',
  documentKind: 'fixture-source',
  extension: 'lang',
  document: {
    uri: DOCUMENT_URI,
    languageId: 'fixture-language',
    version,
    text,
  },
})

const candidateProvider: SubjectCandidateProvider = {
  summary: async () => ({
    snapshotId: 'subject-completion-fixture',
    totalSubjects: 1,
    completeness: 'complete',
  }),
  candidates: async () => ({
    items: [{ subjectId: 'unit/Alpha', label: 'Alpha', kind: 'unit', tags: ['selectable'] }],
  }),
}

async function openWorkspace(
  subjectCandidates: SubjectCandidateProviderSource,
  workspaceIncomplete: boolean | (() => boolean) = false,
  documentSource?: LanguageWorkspaceDocumentSource,
  documentOrigin?: (document: LanguageDocument) => LanguageWorkspaceDocumentOrigin | undefined,
  semanticInputs?: () => readonly LanguageWorkspaceSemanticInput[],
  initialText = 'value',
  workspaceBudgets?: typeof budgets,
) {
  const workspace = createLanguageWorkspace({
    services,
    grant: { id: 'subject-completion-test', classes: [] },
    budgets,
    ...(workspaceBudgets === undefined ? {} : { workspaceBudgets }),
    subjectCandidates,
    workspaceIncomplete,
    ...(documentSource === undefined ? {} : { documentSource }),
    ...(documentOrigin === undefined ? {} : { documentOrigin }),
    ...(semanticInputs === undefined ? {} : { semanticInputs }),
  })
  await workspace.initialize()
  const opened = await workspace.open(languageRequest(1, initialText))
  if (opened.state !== 'resolved') {
    throw new Error(`neutral language fixture did not resolve: ${JSON.stringify(opened)}`)
  }
  return workspace
}

function delayedReleaseSource() {
  let enteredRelease = (): void => undefined
  let finishRelease = (): void => undefined
  const releaseEntered = new Promise<void>(resolve => {
    enteredRelease = resolve
  })
  const releaseGate = new Promise<void>(resolve => {
    finishRelease = resolve
  })
  const scopes: string[] = []
  let releases = 0
  const source: SubjectCandidateProviderSource = {
    async open(scope) {
      scopes.push(scope.uri)
      return {
        value: candidateProvider,
        async release() {
          enteredRelease()
          await releaseGate
          releases += 1
        },
      }
    },
  }
  return {
    source,
    releaseEntered,
    finishRelease,
    scopes,
    releases: () => releases,
  }
}

const completionRequest = () => ({
  uri: DOCUMENT_URI,
  documentVersion: 1,
  position: { line: 0, character: 0 },
  maxResults: 8,
})

describe('language subject completion lifecycle', () => {
  it('does not resolve a subject candidate source for ordinary provider completions', async () => {
    const open = vi.fn(async () => undefined)
    const original = provider.completion
    provider.completion = async () => ({
      items: [{ label: 'Catalog', kind: 'class' }],
      isIncomplete: false,
    })
    const workspace = await openWorkspace({ open })
    try {
      await expect(workspace.completion(completionRequest())).resolves.toEqual({
        items: [{ label: 'Catalog', kind: 'class' }],
        isIncomplete: false,
      })
      expect(open).not.toHaveBeenCalled()
    } finally {
      if (original === undefined) delete provider.completion
      else provider.completion = original
      await workspace.shutdown()
    }
  })

  it('carries preselect, commit characters, retrigger, deprecation and the asset kinds', async () => {
    const items = [
      { label: 'OnHit', kind: 'event', preselect: true },
      { label: 'name=""', kind: 'property', retrigger: true, commitCharacters: ['='] },
      { label: 'OldField', kind: 'field', deprecated: true },
      { label: 'Red', kind: 'color', documentation: '#ff0000' },
      { label: 'Assets/Textures', kind: 'folder' },
      { label: 'Assets/Textures/btn.dds', kind: 'file' },
      { label: 'Normal', kind: 'enum-member' },
    ] as const
    const original = provider.completion
    provider.completion = async () => ({ items, isIncomplete: false })
    const workspace = await openWorkspace({ open: vi.fn(async () => undefined) })
    try {
      await expect(workspace.completion(completionRequest())).resolves.toEqual({
        items,
        isIncomplete: false,
      })
      provider.completion = async () => ({
        items: [{ label: 'x', kind: 'text', commitCharacters: ['=='] }],
        isIncomplete: false,
      })
      await expect(workspace.completion(completionRequest())).rejects.toThrow()
    } finally {
      if (original === undefined) delete provider.completion
      else provider.completion = original
      await workspace.shutdown()
    }
  })

  it('routes folding ranges, links, highlights and inlay hints, and checks each', async () => {
    const features = provider as {
      -readonly [
        K in 'foldingRanges' | 'documentLinks' | 'documentHighlights' | 'inlayHints'
      ]?: unknown
    }
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }
    features.foldingRanges = async () => ({
      ranges: [{ startLine: 0, endLine: 2, kind: 'region' }],
      isIncomplete: false,
    })
    features.documentLinks = async () => ({
      links: [{ range, target: 'file:///workspace/include.lang', tooltip: 'Open include' }],
      isIncomplete: false,
    })
    features.documentHighlights = async (request: { position: unknown }) => ({
      highlights: [{ range, kind: request.position === undefined ? 'text' : 'write' }],
      isIncomplete: false,
    })
    features.inlayHints = async (request: { range: unknown }) => ({
      hints:
        request.range === undefined
          ? []
          : [{ position: { line: 1, character: 1 }, label: ': Unit', kind: 'type' }],
      isIncomplete: false,
    })
    const workspace = await openWorkspace(
      { open: vi.fn(async () => undefined) },
      false,
      undefined,
      undefined,
      undefined,
      'abc\ndef\nghi',
    )
    try {
      expect((await workspace.capabilities(DOCUMENT_URI))?.features).toEqual(
        expect.arrayContaining([
          'folding-ranges',
          'document-links',
          'document-highlights',
          'inlay-hints',
        ]),
      )
      const request = completionRequest()
      expect((await workspace.foldingRanges(request))?.ranges).toEqual([
        { startLine: 0, endLine: 2, kind: 'region' },
      ])
      expect((await workspace.documentLinks(request))?.links[0]?.target).toBe(
        'file:///workspace/include.lang',
      )
      expect((await workspace.documentHighlights(request))?.highlights[0]?.kind).toBe('write')
      expect(
        (
          await workspace.inlayHints({
            ...request,
            range: { start: range.start, end: { line: 2, character: 3 } },
          })
        )?.hints[0]?.label,
      ).toBe(': Unit')
      await expect(
        workspace.inlayHints({
          ...request,
          range: { start: range.start, end: { line: 9, character: 0 } },
        }),
      ).rejects.toThrow()
      features.foldingRanges = async () => ({
        ranges: [{ startLine: 1, endLine: 5 }],
        isIncomplete: false,
      })
      await expect(workspace.foldingRanges(request)).rejects.toThrow(/folding ranges/u)
    } finally {
      delete features.foldingRanges
      delete features.documentLinks
      delete features.documentHighlights
      delete features.inlayHints
      await workspace.shutdown()
    }
  })

  it('preserves document-wide lenses beyond the interactive limit without unbounding requests', async () => {
    const features = provider as { -readonly [K in 'codeLenses']?: LanguageProvider[K] }
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }
    const lenses = Array.from({ length: 3_000 }, (_, index) => ({
      range,
      title: 'Card',
      command: {
        kind: 'open-subject' as const,
        subjectId: `Fixture/${index}`,
        view: 'card' as const,
      },
    }))
    features.codeLenses = async () => ({ lenses, isIncomplete: false })
    const workspace = await openWorkspace({ open: vi.fn(async () => undefined) })
    try {
      const request = { ...completionRequest(), maxResults: 65_536 }
      const answer = await workspace.codeLenses(request)
      expect(answer?.lenses).toHaveLength(3_000)
      expect(answer?.lenses.at(-1)?.command).toEqual(lenses.at(-1)?.command)
      await expect(workspace.codeLenses({ ...request, maxResults: 65_537 })).rejects.toThrow(
        /maxResults/u,
      )
      await expect(workspace.completion(request)).rejects.toThrow(/maxResults/u)
      features.codeLenses = async () => ({
        lenses: [{ range, title: 'Bad', command: { kind: 'open-subject', subjectId: '' } }],
        isIncomplete: false,
      })
      await expect(workspace.codeLenses(request)).rejects.toThrow(/code lenses/u)
    } finally {
      delete features.codeLenses
      await workspace.shutdown()
    }
  })

  it('routes code lenses and commands, and diagnostics with tags and related places', async () => {
    const features = provider as {
      -readonly [K in 'codeLenses' | 'codeActions' | 'diagnostics']?: unknown
    }
    const originalDiagnostics = features.diagnostics
    const originalCodeActions = features.codeActions
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }
    const card = { kind: 'open-subject', subjectId: 'Unit/Marine', view: 'card' }
    features.codeLenses = async () => ({
      lenses: [
        { range, title: 'inherited from Liberty' },
        { range, title: 'Card', command: card },
      ],
      isIncomplete: false,
    })
    features.codeActions = async () => ({
      actions: [{ title: 'Open the Marine', command: card }],
      isIncomplete: false,
    })
    const unused = {
      range,
      severity: 'hint',
      message: 'unused variable',
      tags: ['unnecessary'],
      relatedInformation: [
        { location: { uri: 'file:///workspace/other.lang', range }, message: 'declared here' },
      ],
      codeDescription: 'https://example.org/rules/unused',
    }
    features.diagnostics = async () => ({ diagnostics: [unused], isIncomplete: false })
    const workspace = await openWorkspace({ open: vi.fn(async () => undefined) })
    try {
      const request = completionRequest()
      expect((await workspace.codeLenses(request))?.lenses).toHaveLength(2)
      expect(
        (await workspace.codeActions({ ...request, range, diagnostics: [] }))?.actions[0]?.command,
      ).toEqual(card)
      expect((await workspace.diagnostics(request))?.diagnostics).toEqual([unused])
      features.codeLenses = async () => ({
        lenses: [{ range, title: 'Run', command: { kind: 'run-script', script: 'rm' } }],
        isIncomplete: false,
      })
      await expect(workspace.codeLenses(request)).rejects.toThrow(/code lenses/u)
      features.diagnostics = async () => ({
        diagnostics: [{ ...unused, codeDescription: 'javascript:alert(1)' }],
        isIncomplete: false,
      })
      await expect(workspace.diagnostics(request)).rejects.toThrow()
    } finally {
      delete features.codeLenses
      features.codeActions = originalCodeActions
      features.diagnostics = originalDiagnostics
      await workspace.shutdown()
    }
  })

  it.each(['syntax', 'semantic', 'incomplete'])(
    'checks only closed writable project documents with %s diagnostics',
    async mode => {
      const project = (name: string) => `file:///workspace/${name}.lang`
      const documents = [
        { uri: project('units'), languageId: 'fixture-language', version: 3, text: 'bad unit' },
        { uri: project('weapons'), languageId: 'fixture-language', version: 1, text: 'fine' },
        {
          uri: 'file:///core/base.lang',
          languageId: 'fixture-language',
          version: 1,
          text: 'bad base',
        },
      ]
      const origin = (uri: string, readOnly: boolean, precedence: number) => ({
        uri,
        layerId: readOnly ? 'core' : 'project',
        logicalId: uri.slice(uri.lastIndexOf('/') + 1),
        precedence,
        sourceRevision: `${uri}:1`,
        readOnly,
      })
      const source: LanguageWorkspaceDocumentSource = {
        snapshot: async () => ({
          documents,
          isComplete: true,
          workspaceContext: {
            id: 'project-context',
            revision: 'project-context:1',
            semanticComplete: true,
            documentOrigins: [
              origin(project('units'), false, 2),
              origin(project('weapons'), false, 3),
              origin('file:///core/base.lang', true, 0),
              origin(DOCUMENT_URI, false, 4),
            ],
          },
        }),
      }
      const analyzed: string[] = []
      const checked: string[] = []
      const features = provider as { -readonly [K in 'diagnostics']?: LanguageProvider[K] }
      const originalDiagnostics = features.diagnostics
      const originalAnalyze = provider.analyze
      ;(provider as { analyze: LanguageProvider['analyze'] }).analyze = async request => {
        analyzed.push(request.document.uri)
        return {
          ...analysisFor(request.document),
          diagnostics: request.document.text.startsWith('bad')
            ? [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                  severity: 'error',
                  message: 'bad entry',
                },
              ]
            : [],
        }
      }
      if (mode !== 'syntax') {
        features.diagnostics = async request => {
          checked.push(request.document.uri)
          expect(request.workspaceDocuments.map(item => item.uri)).toContain(project('units'))
          expect(request.workspaceContext?.documentOrigins).toContainEqual(
            origin(request.document.uri, false, request.document.uri === project('units') ? 2 : 3),
          )
          return {
            diagnostics: request.document.text.startsWith('bad')
              ? [
                  {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    severity: 'error',
                    message: 'bad semantic entry',
                  },
                ]
              : [],
            // A later clean document can still have an incomplete semantic context.
            isIncomplete: mode === 'incomplete' && request.document.uri === project('weapons'),
          }
        }
      }
      const workspace = await openWorkspace(
        { open: async () => undefined },
        false,
        source,
        document => origin(document.uri, false, 4),
      )
      try {
        analyzed.length = 0
        const report = await workspace.projectDiagnostics(completionRequest())
        // the open document and the read-only core layer are not re-checked
        expect(analyzed.sort()).toEqual(
          mode === 'syntax' ? [project('units'), project('weapons')] : [],
        )
        expect(checked.sort()).toEqual(
          mode === 'syntax' ? [] : [project('units'), project('weapons')],
        )
        expect(
          report?.documents.map(item => [item.uri, item.version, item.diagnostics.length]),
        ).toEqual([
          [project('units'), 3, 1],
          [project('weapons'), 1, 0],
        ])
        expect(report?.documents[0]?.diagnostics[0]?.message).toBe(
          mode === 'syntax' ? 'bad entry' : 'bad semantic entry',
        )
        expect(report?.isIncomplete).toBe(mode === 'incomplete')
      } finally {
        ;(provider as { analyze: LanguageProvider['analyze'] }).analyze = originalAnalyze
        if (originalDiagnostics === undefined) delete features.diagnostics
        else features.diagnostics = originalDiagnostics
        await workspace.shutdown()
      }
    },
  )

  it('draws the assets a hover or a focused completion names, and keeps its links', async () => {
    const features = provider as {
      -readonly [K in 'hover' | 'resolveCompletion']?: unknown
    }
    const originalHover = features.hover
    const card = { kind: 'open-subject', subjectId: 'Unit/Marine', view: 'card' }
    const texture = 'Assets\\Textures\\btn-unit-terran-marine.dds'
    features.hover = async () => ({
      markdown: '**Marine**',
      assets: [{ path: texture, label: 'Marine [button]' }, { path: 'missing.dds' }],
      commands: [{ title: 'Card', command: card }],
    })
    features.resolveCompletion = async (request: { item: Record<string, unknown> }) => ({
      ...request.item,
      documentation: 'A foot soldier.',
      asset: { path: texture },
    })
    const drawn: string[] = []
    const workspace = createLanguageWorkspace({
      services,
      grant: { id: 'asset-picture-test', classes: [] },
      budgets,
      assetImage: async request => {
        drawn.push(`${request.path}@${String(request.maxEdge)}`)
        return request.path === texture
          ? { mediaType: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }
          : undefined
      },
    })
    await workspace.initialize()
    try {
      await workspace.open(languageRequest(1))
      const hover = await workspace.hover(completionRequest())
      expect(hover?.markdown).toBe('**Marine**\n\n![Marine button](data:image/png;base64,iVBORw==)')
      expect(hover?.commands).toEqual([{ title: 'Card', command: card }])
      expect(drawn).toEqual([`${texture}@128`, 'missing.dds@128'])
      const item = { label: 'Marine', kind: 'class' as const }
      const resolved = await workspace.resolveCompletion({ ...completionRequest(), item })
      expect(resolved?.documentation).toBe(
        'A foot soldier.\n\n![Assets/Textures/btn-unit-terran-marine.dds](data:image/png;base64,iVBORw==)',
      )
      features.resolveCompletion = async () => ({ label: 'Other', kind: 'class' })
      await expect(workspace.resolveCompletion({ ...completionRequest(), item })).rejects.toThrow(
        /another one/u,
      )
    } finally {
      features.hover = originalHover
      delete features.resolveCompletion
      await workspace.shutdown()
    }
  })

  it('routes and validates protocol-neutral on-type formatting edits', async () => {
    const workspace = await openWorkspace({ open: async () => undefined })
    try {
      await expect(
        workspace.onTypeFormatting({
          ...completionRequest(),
          ch: '=',
          options: { tabSize: 2, insertSpaces: true },
        }),
      ).resolves.toEqual({
        edits: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: '""',
          },
        ],
        isComplete: true,
        cursor: { line: 0, character: 1 },
        requestCompletion: true,
      })
      await expect(
        workspace.onTypeFormatting({
          ...completionRequest(),
          ch: '==',
          options: { tabSize: 2, insertSpaces: true },
        }),
      ).rejects.toThrow(/exactly one trigger character/u)
    } finally {
      await workspace.shutdown()
    }
  })

  it('falls back to the provider when the reference index recognizes an unresolved definition', async () => {
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      {
        snapshot: async () => ({
          documents: [
            {
              uri: 'file:///workspace/dependency.lang',
              languageId: 'fixture-language',
              version: 1,
              text: 'dependency',
            },
          ],
          isComplete: true,
        }),
      },
      document => ({
        uri: document.uri,
        layerId: 'fixture:workspace',
        logicalId: document.uri.slice('file:///workspace/'.length),
        precedence: 0,
        sourceRevision: `fixture:${document.version}:${document.text}`,
        readOnly: false,
      }),
      undefined,
      'indexed-use',
    )
    try {
      await expect(workspace.definition(completionRequest())).resolves.toMatchObject({
        locations: [{ uri: 'file:///workspace/dependency.lang' }],
      })
    } finally {
      await workspace.shutdown()
    }
  })

  it('falls back to the provider when the reference index has no reference locations', async () => {
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      {
        snapshot: async () => ({
          documents: [
            {
              uri: 'file:///workspace/dependency.lang',
              languageId: 'fixture-language',
              version: 1,
              text: 'dependency',
            },
          ],
          isComplete: true,
        }),
      },
      document => ({
        uri: document.uri,
        layerId: 'fixture:workspace',
        logicalId: document.uri.slice('file:///workspace/'.length),
        precedence: 0,
        sourceRevision: `fixture:${document.version}:${document.text}`,
        readOnly: false,
      }),
      undefined,
      'indexed-declaration',
    )
    try {
      await expect(
        workspace.references({ ...completionRequest(), includeDeclaration: false }),
      ).resolves.toMatchObject({ locations: [{ uri: 'file:///workspace/dependency.lang' }] })
    } finally {
      await workspace.shutdown()
    }
  })

  it('answers index and provider together, without duplicates', async () => {
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      {
        snapshot: async () => ({
          documents: [
            {
              uri: 'file:///workspace/dependency.lang',
              languageId: 'fixture-language',
              version: 1,
              text: 'dependency',
            },
          ],
          isComplete: true,
        }),
      },
      document => ({
        uri: document.uri,
        layerId: 'fixture:workspace',
        logicalId: document.uri.slice('file:///workspace/'.length),
        precedence: 0,
        sourceRevision: `fixture:${document.version}:${document.text}`,
        readOnly: false,
      }),
      undefined,
      'indexed-declaration',
    )
    try {
      await expect(
        workspace.references({ ...completionRequest(), includeDeclaration: true }),
      ).resolves.toMatchObject({
        // the index knows the declaration, the provider the references it merges from other files
        locations: [{ uri: DOCUMENT_URI }, { uri: 'file:///workspace/dependency.lang' }],
      })
    } finally {
      await workspace.shutdown()
    }
  })

  it('asks the provider for occurrences once per snapshot and again after an edit', async () => {
    const original = provider.referenceOccurrences
    if (original === undefined) throw new Error('the fixture provider publishes occurrences')
    let asked = 0
    provider.referenceOccurrences = request => {
      asked += 1
      return original(request)
    }
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      {
        snapshot: async () => ({
          documents: [
            {
              uri: 'file:///workspace/dependency.lang',
              languageId: 'fixture-language',
              version: 1,
              text: 'dependency',
            },
          ],
          isComplete: true,
        }),
      },
      document => ({
        uri: document.uri,
        layerId: 'fixture:workspace',
        logicalId: document.uri.slice('file:///workspace/'.length),
        precedence: 0,
        sourceRevision: `fixture:${document.version}:${document.text}`,
        readOnly: false,
      }),
      undefined,
      'indexed-declaration',
    )
    try {
      const request = { ...completionRequest(), includeDeclaration: true }
      const first = await workspace.references(request)
      expect(first?.locations).toHaveLength(2)
      await expect(workspace.references(request)).resolves.toEqual(first)
      await workspace.definition(completionRequest())
      expect(asked).toBe(1)
      // An edit is another snapshot: the index must not answer from the old batches.
      await workspace.change(languageRequest(2, 'indexed-declaration, edited'))
      await expect(workspace.references({ ...request, documentVersion: 2 })).resolves.toMatchObject(
        {
          locations: [{ uri: DOCUMENT_URI }, { uri: 'file:///workspace/dependency.lang' }],
        },
      )
      expect(asked).toBe(2)
    } finally {
      provider.referenceOccurrences = original
      await workspace.shutdown()
    }
  })

  it.each([false, true])(
    'retains isolated reference indexes across documents (new provider instances: %s)',
    async fresh => {
      const original = provider.referenceOccurrences
      if (original === undefined) throw new Error('the fixture provider publishes occurrences')
      const asked = new Map<string, number>()
      provider.referenceOccurrences = request => {
        asked.set(request.document.uri, (asked.get(request.document.uri) ?? 0) + 1)
        return original(request)
      }
      if (fresh) providerFactory = () => ({ ...provider })
      const origin = (document: LanguageDocument): LanguageWorkspaceDocumentOrigin => ({
        uri: document.uri,
        layerId: 'fixture:workspace',
        logicalId: document.uri,
        precedence: 0,
        sourceRevision: String(document.version),
        readOnly: false,
      })
      const workspace = await openWorkspace(
        { open: async () => undefined },
        false,
        undefined,
        origin,
        undefined,
        'indexed-declaration',
      )
      const other = 'file:///workspace/other.lang'
      try {
        await workspace.open({
          ...languageRequest(1),
          document: { ...languageRequest(1, 'indexed-declaration').document, uri: other },
        })
        for (const uri of [DOCUMENT_URI, other, DOCUMENT_URI, other]) {
          await expect(
            workspace.definition({ ...completionRequest(), uri }),
          ).resolves.toMatchObject({
            locations: [{ uri }],
          })
        }
        expect([...asked.values()]).toEqual([1, 1])
        for (const maxResults of [1, 8, 1, 8]) {
          await workspace.definition({ ...completionRequest(), maxResults })
        }
        expect([...asked.values()]).toEqual([2, 1])
        await workspace.change(languageRequest(2, 'indexed-declaration edited'))
        await workspace.definition({ ...completionRequest(), documentVersion: 2 })
        await workspace.definition({ ...completionRequest(), uri: other })
        expect([...asked.values()]).toEqual([3, 2])
      } finally {
        provider.referenceOccurrences = original
        providerFactory = () => provider
        await workspace.shutdown()
      }
    },
  )

  it('does not retain a reference index beyond the workspace byte allowance', async () => {
    const original = provider.referenceOccurrences
    if (original === undefined) throw new Error('the fixture provider publishes occurrences')
    let asked = 0
    provider.referenceOccurrences = request => {
      asked += 1
      return original(request)
    }
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      undefined,
      document => ({
        uri: document.uri,
        layerId: 'workspace',
        logicalId: 'fixture',
        precedence: 0,
        sourceRevision: '1',
        readOnly: false,
      }),
      undefined,
      'indexed-declaration',
      { ...budgets, maxInputBytes: 1024n },
    )
    try {
      for (let call = 0; call < 2; call += 1) {
        await expect(
          workspace.definition({
            ...completionRequest(),
            position: { line: 0, character: call },
          }),
        ).resolves.toMatchObject({
          locations: [{ uri: DOCUMENT_URI }],
        })
      }
      expect(asked).toBe(2)
    } finally {
      provider.referenceOccurrences = original
      await workspace.shutdown()
    }
  })

  it('reuses exact navigation answers after index eviction without sharing mutable results', async () => {
    const original = provider.referenceOccurrences
    if (original === undefined) throw new Error('the fixture provider publishes occurrences')
    const asked = new Map<string, number>()
    provider.referenceOccurrences = request => {
      asked.set(request.document.uri, (asked.get(request.document.uri) ?? 0) + 1)
      return original(request)
    }
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      undefined,
      document => ({
        uri: document.uri,
        layerId: 'workspace',
        logicalId: document.uri,
        precedence: 0,
        sourceRevision: String(document.version),
        readOnly: false,
      }),
      undefined,
      'indexed-declaration',
    )
    const others = Array.from({ length: 8 }, (_, i) => `file:///workspace/other-${i}.lang`)
    try {
      for (const uri of others) {
        await workspace.open({
          ...languageRequest(1),
          document: { ...languageRequest(1, 'indexed-declaration').document, uri },
        })
      }
      const first = await workspace.definition(completionRequest())
      for (const uri of others) await workspace.definition({ ...completionRequest(), uri })
      const cached = await workspace.definition(completionRequest())
      expect(cached).toEqual(first)
      expect(cached).not.toBe(first)
      expect(cached?.locations).not.toBe(first?.locations)
      expect(asked.get(DOCUMENT_URI)).toBe(1)
      await workspace.definition({ ...completionRequest(), position: { line: 0, character: 1 } })
      expect(asked.get(DOCUMENT_URI)).toBe(2)
      await workspace.change(languageRequest(2, 'indexed-declaration edited'))
      await workspace.definition({ ...completionRequest(), documentVersion: 2 })
      expect(asked.get(DOCUMENT_URI)).toBe(3)
    } finally {
      provider.referenceOccurrences = original
      await workspace.shutdown()
    }
  })

  it('does not publish reference batches returned after invalidation', async () => {
    const original = provider.referenceOccurrences
    if (original === undefined) throw new Error('the fixture provider publishes occurrences')
    let entered = (): void => undefined
    let finish = (): void => undefined
    const started = new Promise<void>(resolve => {
      entered = resolve
    })
    const gate = new Promise<void>(resolve => {
      finish = resolve
    })
    let asked = 0
    provider.referenceOccurrences = async request => {
      asked += 1
      if (asked === 1) {
        entered()
        await gate
      }
      return original(request)
    }
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      undefined,
      document => ({
        uri: document.uri,
        layerId: 'workspace',
        logicalId: 'fixture',
        precedence: 0,
        sourceRevision: '1',
        readOnly: false,
      }),
      undefined,
      'indexed-declaration',
    )
    try {
      const pending = workspace.definition(completionRequest())
      const cancelled = expect(pending).rejects.toThrow()
      await started
      workspace.invalidate('dependency changed')
      finish()
      await cancelled
      await expect(workspace.definition(completionRequest())).resolves.toMatchObject({
        locations: [{ uri: DOCUMENT_URI }],
      })
      expect(asked).toBe(2)
    } finally {
      finish()
      provider.referenceOccurrences = original
      await workspace.shutdown()
    }
  })

  it.each([
    {
      name: 'complete dependency context',
      providerIncomplete: false,
      sourceComplete: true,
      contextComplete: true,
      callerIncomplete: false,
      fallback: false,
      expected: false,
    },
    {
      name: 'provider-reported incompleteness',
      providerIncomplete: true,
      sourceComplete: true,
      contextComplete: true,
      callerIncomplete: false,
      fallback: false,
      expected: true,
    },
    {
      name: 'truncated dependency source',
      providerIncomplete: false,
      sourceComplete: false,
      contextComplete: true,
      callerIncomplete: false,
      fallback: false,
      expected: true,
    },
    {
      name: 'partial semantic context',
      providerIncomplete: false,
      sourceComplete: true,
      contextComplete: false,
      callerIncomplete: false,
      fallback: false,
      expected: true,
    },
    {
      name: 'caller-reported incompleteness',
      providerIncomplete: false,
      sourceComplete: true,
      contextComplete: true,
      callerIncomplete: true,
      fallback: false,
      expected: true,
    },
    {
      name: 'analysis fallback with complete read-only dependencies',
      providerIncomplete: false,
      sourceComplete: true,
      contextComplete: true,
      callerIncomplete: false,
      fallback: true,
      expected: false,
    },
  ])('preserves diagnostic findings and completeness for $name', async scenario => {
    const findings = [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 'warning' as const,
        message: 'Provider-owned finding',
        code: 'fixture/diagnostic',
      },
    ]
    if (!scenario.fallback) {
      provider.diagnostics = async () => ({
        diagnostics: findings,
        isIncomplete: scenario.providerIncomplete,
      })
    }
    const dependencyUri = 'content-source://fixture/dependency.lang'
    const workspace = await openWorkspace(
      { open: async () => undefined },
      scenario.callerIncomplete,
      {
        snapshot: async () => ({
          documents: [
            { uri: dependencyUri, languageId: 'fixture-language', version: 1, text: 'dependency' },
          ],
          isComplete: scenario.sourceComplete,
          workspaceContext: {
            id: 'diagnostics-context',
            revision: 'diagnostics-context:1',
            semanticComplete: scenario.contextComplete,
            documentOrigins: [
              {
                uri: dependencyUri,
                layerId: 'dependency',
                logicalId: 'dependency.lang',
                precedence: 0,
                sourceRevision: 'dependency:1',
                readOnly: true,
              },
            ],
          },
        }),
      },
      document => ({
        uri: document.uri,
        layerId: 'workspace',
        logicalId: 'fixture.lang',
        precedence: 1,
        sourceRevision: `open:${document.version}`,
        readOnly: false,
        overlay: true,
      }),
    )
    try {
      await expect(workspace.diagnostics(completionRequest())).resolves.toEqual({
        diagnostics: scenario.fallback ? [] : findings,
        isIncomplete: scenario.expected,
      })
    } finally {
      delete provider.diagnostics
      await workspace.shutdown()
    }
  })

  it('rejects malformed diagnostic completeness before applying host context', async () => {
    provider.diagnostics = async () =>
      ({
        diagnostics: [],
        isIncomplete: 'false',
      }) as unknown as LanguageDiagnosticList
    const workspace = await openWorkspace({ open: async () => undefined }, true)
    try {
      await expect(workspace.diagnostics(completionRequest())).rejects.toThrow(
        /invalid or unbounded diagnostics/u,
      )
    } finally {
      delete provider.diagnostics
      await workspace.shutdown()
    }
  })

  it('adds bounded read-only dependency documents to semantic feature snapshots', async () => {
    observedWorkspaceIncomplete = undefined
    observedWorkspaceDocuments = []
    const workspace = await openWorkspace({ open: async () => undefined }, false, {
      snapshot: async request => ({
        documents:
          request.maxDocuments > 0
            ? [
                {
                  uri: 'file:///workspace/dependency.lang',
                  languageId: 'fixture-language',
                  version: 1,
                  text: 'dependency',
                },
              ]
            : [],
        isComplete: true,
      }),
    })
    try {
      const result = await workspace.definition(completionRequest())
      expect(result).toEqual({
        locations: [
          {
            uri: 'file:///workspace/dependency.lang',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 10 },
            },
          },
        ],
        isIncomplete: true,
      })
      await workspace.completion(completionRequest())
      expect(observedWorkspaceDocuments).toEqual([
        DOCUMENT_URI,
        'file:///workspace/dependency.lang',
      ])
      expect(observedWorkspaceIncomplete).toBe(true)
    } finally {
      await workspace.shutdown()
    }
  })

  it('replaces only the same-layer file with an open overlay and retains weaker layers', async () => {
    const baseUri = 'content-source://fixture/base/fixture.lang'
    const dependencyUri = 'content-source://fixture/layer/fixture.lang'
    const logicalId = 'layer/fixture.lang'
    const source: LanguageWorkspaceDocumentSource = {
      snapshot: async request => ({
        documents: [
          {
            uri: baseUri,
            languageId: 'fixture-language',
            version: 1,
            text: 'base',
          },
          {
            uri: dependencyUri,
            languageId: 'fixture-language',
            version: 1,
            text: 'dependency',
          },
        ],
        isComplete: true,
        workspaceContext: {
          id: 'fixture-context',
          revision: 'fixture-context:1',
          semanticComplete: true,
          documentOrigins: [
            {
              uri: baseUri,
              layerId: 'base-layer',
              logicalId,
              precedence: 0,
              sourceRevision: 'base:1',
              readOnly: true,
            },
            {
              uri: dependencyUri,
              layerId: 'fixture-layer',
              logicalId,
              precedence: 1,
              sourceRevision: 'dependency:1',
              readOnly: true,
            },
          ],
        },
      }),
    }
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      source,
      document => ({
        uri: document.uri,
        layerId: 'fixture-layer',
        logicalId,
        precedence: 2,
        sourceRevision: `open:${document.version}`,
        readOnly: false,
        overlay: true,
      }),
    )
    try {
      await workspace.completion(completionRequest())
      expect(observedWorkspaceDocuments).toEqual([baseUri, DOCUMENT_URI])
      // Every document has an origin: read-only layers are present, not missing.
      expect(observedWorkspaceIncomplete).toBe(false)
      expect(observedWorkspaceContext).toMatchObject({
        id: expect.stringMatching(/^language-context-v1:/u),
        semanticComplete: true,
        semanticInputs: expect.arrayContaining([
          { kind: 'schema', id: 'fixture/schema@1', revision: 'fixture-schema:1' },
          expect.objectContaining({ kind: 'provider-artifact' }),
        ]),
        documentOrigins: [
          { uri: baseUri, layerId: 'base-layer', logicalId, readOnly: true },
          {
            uri: DOCUMENT_URI,
            layerId: 'fixture-layer',
            logicalId,
            readOnly: false,
            overlay: true,
          },
        ],
      })
      const firstRevision = observedWorkspaceContext?.revision

      await workspace.change(languageRequest(2))
      await workspace.completion({ ...completionRequest(), documentVersion: 2 })
      expect(observedWorkspaceContext?.revision).not.toBe(firstRevision)
    } finally {
      await workspace.shutdown()
    }
  })

  it('preserves the bounded reason when semantic input validation fails', async () => {
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      undefined,
      undefined,
      () => [{ kind: 'schema', id: 'fixture/schema@1', revision: 'conflicting-schema' }],
    )
    try {
      await expect(workspace.hover(completionRequest())).rejects.toMatchObject({
        code: 'x3.host/language-feature-invalid',
        message:
          'language workspace semantic inputs are invalid or conflicting: language workspace semantic input schema/fixture/schema@1 conflicts',
      })
    } finally {
      await workspace.shutdown()
    }
  })

  it('changes semantic revision when a host-owned input changes without editing the buffer', async () => {
    let localeRevision = 'locale:enUS:1'
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      undefined,
      undefined,
      () => [{ kind: 'locale-set', id: 'selected-game-locales:enUS', revision: localeRevision }],
    )
    try {
      await workspace.completion(completionRequest())
      const first = observedWorkspaceContext
      localeRevision = 'locale:enUS:2'
      workspace.invalidate('locale data changed')
      await workspace.completion(completionRequest())
      expect(observedWorkspaceContext?.id).toBe(first?.id)
      expect(observedWorkspaceContext?.revision).not.toBe(first?.revision)
    } finally {
      await workspace.shutdown()
    }
  })

  it('defensively copies a host-owned semantic payload before calling the provider', async () => {
    const payload = { locale: { ids: ['enUS'] } }
    const workspace = await openWorkspace(
      { open: async () => undefined },
      false,
      undefined,
      undefined,
      () => [{ kind: 'locale-set', id: 'selected-game-locales', revision: '1', payload }],
    )
    try {
      await workspace.completion(completionRequest())
      const copied = observedWorkspaceContext?.semanticInputs?.find(
        input => input.id === 'selected-game-locales',
      )?.payload
      expect(copied).toEqual(payload)
      expect(copied).not.toBe(payload)
      expect(Object.isFrozen(copied)).toBe(true)
      payload.locale.ids[0] = 'deDE'
      expect(copied).toEqual({ locale: { ids: ['enUS'] } })
    } finally {
      await workspace.shutdown()
    }
  })

  it('includes open document bytes in revision even when URI and version are identical', async () => {
    const first = await openWorkspace(
      { open: async () => undefined },
      false,
      undefined,
      undefined,
      undefined,
      'alpha',
    )
    let firstRevision: string | undefined
    try {
      await first.completion(completionRequest())
      firstRevision = observedWorkspaceContext?.revision
    } finally {
      await first.shutdown()
    }
    const second = await openWorkspace(
      { open: async () => undefined },
      false,
      undefined,
      undefined,
      undefined,
      'bravo',
    )
    try {
      await second.completion(completionRequest())
      expect(observedWorkspaceContext?.revision).not.toBe(firstRevision)
    } finally {
      await second.shutdown()
    }
  })

  it('does not allow rename to write through read-only dependency context', async () => {
    const workspace = await openWorkspace({ open: async () => undefined }, false, {
      snapshot: async () => ({
        documents: [
          {
            uri: 'file:///workspace/dependency.lang',
            languageId: 'fixture-language',
            version: 1,
            text: 'dependency',
          },
        ],
        isComplete: true,
      }),
    })
    try {
      await expect(
        workspace.rename({ ...completionRequest(), newName: 'renamed' }),
      ).rejects.toThrow(/invalid or unbounded workspace edit/u)
    } finally {
      await workspace.shutdown()
    }
  })

  it('renames into unopened project files and refuses a rename that reaches a read-only layer', async () => {
    const projectUri = 'file:///workspace/project.lang'
    const dependencyUri = 'content-source://fixture/installed/dependency.lang'
    const origin = (uri: string, logicalId: string, readOnly: boolean, precedence: number) => ({
      uri,
      layerId: readOnly ? 'installed-layer' : 'project-layer',
      logicalId,
      precedence,
      sourceRevision: `${logicalId}:1`,
      readOnly,
    })
    const sourceWith = (dependency: boolean): LanguageWorkspaceDocumentSource => ({
      snapshot: async () => ({
        documents: [
          { uri: projectUri, languageId: 'fixture-language', version: 1, text: 'value' },
          ...(dependency
            ? [{ uri: dependencyUri, languageId: 'fixture-language', version: 1, text: 'value' }]
            : []),
        ],
        isComplete: true,
        workspaceContext: {
          id: 'rename-context',
          revision: `rename-context:${String(dependency)}`,
          semanticComplete: true,
          documentOrigins: [
            origin(projectUri, 'project.lang', false, 1),
            ...(dependency ? [origin(dependencyUri, 'dependency.lang', true, 0)] : []),
          ],
        },
      }),
    })
    const openDocument = (document: LanguageDocument) => ({
      ...origin(document.uri, 'open.lang', false, 2),
      overlay: true,
    })
    const project = await openWorkspace(
      { open: async () => undefined },
      false,
      sourceWith(false),
      openDocument,
    )
    try {
      const edit = await project.rename({ ...completionRequest(), newName: 'renamed' })
      expect(edit?.documentChanges.map(change => change.uri)).toEqual([DOCUMENT_URI, projectUri])
    } finally {
      await project.shutdown()
    }
    const installed = await openWorkspace(
      { open: async () => undefined },
      false,
      sourceWith(true),
      openDocument,
    )
    try {
      await expect(
        installed.rename({ ...completionRequest(), newName: 'renamed' }),
      ).rejects.toMatchObject({ code: LANGUAGE_EDIT_READ_ONLY })
    } finally {
      await installed.shutdown()
    }
  })

  it('allows a revision-bound local code action with read-only dependency context', async () => {
    const workspace = await openWorkspace({ open: async () => undefined }, false, {
      snapshot: async () => ({
        documents: [
          {
            uri: 'file:///workspace/dependency.lang',
            languageId: 'fixture-language',
            version: 1,
            text: 'dependency',
          },
        ],
        isComplete: true,
      }),
    })
    try {
      const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }
      await expect(
        workspace.codeActions({
          ...completionRequest(),
          range,
          diagnostics: [{ range, severity: 'warning', message: 'fixture', code: 'fixture/token' }],
          maxEdits: 4,
        }),
      ).resolves.toEqual({
        actions: [
          expect.objectContaining({
            title: 'Replace fixture token',
            diagnosticCodes: ['fixture/token'],
            edit: expect.objectContaining({
              documentChanges: [expect.objectContaining({ uri: DOCUMENT_URI, documentVersion: 1 })],
            }),
          }),
        ],
        isIncomplete: false,
      })
    } finally {
      await workspace.shutdown()
    }
  })

  it('marks a caller-bounded workspace incomplete even when every open document fits', async () => {
    observedWorkspaceIncomplete = undefined
    const workspace = await openWorkspace(
      { open: async () => ({ value: candidateProvider, release: async () => undefined }) },
      true,
    )
    try {
      await workspace.completion(completionRequest())
      expect(observedWorkspaceIncomplete).toBe(true)
    } finally {
      await workspace.shutdown()
    }
  })

  it('allows only a revision-bound primary rename for a caller-bounded workspace', async () => {
    const workspace = await openWorkspace(
      { open: async () => ({ value: candidateProvider, release: async () => undefined }) },
      true,
    )
    try {
      await expect(
        workspace.rename({
          ...completionRequest(),
          newName: 'renamed',
          maxEdits: 10,
        }),
      ).resolves.toMatchObject({
        isComplete: true,
        documentChanges: [{ uri: DOCUMENT_URI, documentVersion: 1 }],
      })
    } finally {
      await workspace.shutdown()
    }
  })

  it('expands through a URI-scoped provider and releases its request lease', async () => {
    let releases = 0
    const workspace = await openWorkspace({
      async open(scope) {
        expect(scope).toEqual({ uri: DOCUMENT_URI })
        return {
          value: candidateProvider,
          release: async () => {
            releases += 1
          },
        }
      },
    })
    try {
      const result = await workspace.completion(completionRequest())
      expect(result?.items).toEqual([
        expect.objectContaining({
          label: 'expanded',
          filterText: '<expanded',
          replacementRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        }),
        expect.objectContaining({ insertText: 'unit/Alpha' }),
      ])
      expect(releases).toBe(1)
    } finally {
      await workspace.shutdown()
    }
  })

  it('rejects completion changed while async selector validation is releasing its lease', async () => {
    const delayed = delayedReleaseSource()
    const workspace = await openWorkspace(delayed.source)
    try {
      const pending = workspace.completion(completionRequest())
      const rejection = pending.then(
        () => undefined,
        error => error,
      )
      await delayed.releaseEntered
      await workspace.change(languageRequest(2))
      delayed.finishRelease()
      expect(await rejection).toBeInstanceOf(OperationCancelledError)
      expect(delayed.scopes).toEqual([DOCUMENT_URI])
      expect(delayed.releases()).toBe(1)
    } finally {
      delayed.finishRelease()
      await workspace.shutdown()
    }
  })

  it('rejects completion closed while async selector validation is releasing its lease', async () => {
    const delayed = delayedReleaseSource()
    const workspace = await openWorkspace(delayed.source)
    const pending = workspace.completion(completionRequest())
    const rejection = pending.then(
      () => undefined,
      error => error,
    )
    await delayed.releaseEntered
    await workspace.close(DOCUMENT_URI)
    delayed.finishRelease()
    expect(await rejection).toBeInstanceOf(OperationCancelledError)
    expect(delayed.scopes).toEqual([DOCUMENT_URI])
    expect(delayed.releases()).toBe(1)
    await workspace.shutdown()
  })
})
