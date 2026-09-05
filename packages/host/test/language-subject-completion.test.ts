import { beforeAll, describe, expect, it } from 'vitest'
import { OperationCancelledError, uint64 } from '@modkit/core'
import {
  createHostTopology,
  type SubjectCandidateProvider,
  type SubjectCandidateProviderSource,
} from '@modkit/sdk'
import type { LanguageAnalysis, LanguageDocument, LanguageProvider } from '@modkit/sdk/language'
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
  type LanguageHostServices,
  type LanguageWorkspaceDocumentRequest,
} from '@modkit/host/language'

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

const provider: LanguageProvider = {
  contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  languageIds: ['fixture-language'],
  analyze: request => Promise.resolve(analysisFor(request.document)),
  completion: () =>
    Promise.resolve({
      items: [
        {
          kind: 'subject-ref',
          subjectKind: 'unit',
          filter: { excludeTags: ['default'] },
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
      createProvider: () => ({ value: provider, release: async () => undefined }),
    },
  },
})

let services: LanguageHostServices

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

const languageRequest = (version: number): LanguageWorkspaceDocumentRequest => ({
  languageId: 'fixture-language',
  documentKind: 'fixture-source',
  extension: 'lang',
  document: {
    uri: DOCUMENT_URI,
    languageId: 'fixture-language',
    version,
    text: 'value',
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

async function openWorkspace(subjectCandidates: SubjectCandidateProviderSource) {
  const workspace = createLanguageWorkspace({
    services,
    grant: { id: 'subject-completion-test', classes: [] },
    budgets,
    subjectCandidates,
  })
  await workspace.initialize()
  const opened = await workspace.open(languageRequest(1))
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
      expect(result?.items.map(item => item.insertText)).toEqual(['unit/Alpha'])
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
