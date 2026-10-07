/**
 * The loaded mods' servers of a language workspace (owner decision 07.10): a document placed in
 * the chain that holds it, the editor's unsaved buffers brought to that server before a request
 * reads it and taken away when they close, a provider's questions carried there with the files the
 * answer names given the URIs the host uses, and every server told when files change on disk.
 */
import { describe, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import { createHostTopology, type ContributionContext, type JsonValue } from '@modkit/sdk'
import { LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT, type LanguageProvider } from '@modkit/sdk/language'
import type { ModContext, ModContextOverlay } from '@modkit/vfs/content-sources'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  defineLinkedExtension,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
} from '../src/index.js'
import { createLanguageModContexts, createLanguageWorkspace } from '../src/language/index.js'

const encoder = new TextEncoder()
const UNITS = 'Base.SC2Data/GameData/UnitData.xml'
const MOD_UNITS_URI = `file:///C:/Mods/Mine.SC2Mod/${UNITS}`

/** A chain of two layers — a stock package in a content source and the opened mod on disk. */
function server() {
  const disk = new Map([[`layer:1\u0000${UNITS}`, '<Catalog/>']])
  const overlays = new Map<string, string>()
  const changes: (readonly ModContextOverlay[])[] = []
  const questions: unknown[] = []
  let revision = 0
  let invalidations = 0
  let disposed = false
  const context: ModContext = {
    schemaVersion: 1,
    gameId: 'test/game',
    contextId: 'chain',
    layers: [
      { id: 'layer:0', displayName: 'Core.SC2Mod', sourceId: 'local:casc', sourcePath: 'Mods/Core.SC2Mod', role: 'dependency', provenance: 'implicit', kind: 'package' },
      { id: 'layer:1', displayName: 'Mine.SC2Mod', sourceId: 'host', sourcePath: 'C:/Mods/Mine.SC2Mod', role: 'primary', provenance: 'opened', kind: 'package' },
    ],
    unresolved: [],
    diagnostics: [],
    files: async () => ({ items: [] }),
    async read(layerId, path) {
      const key = `${layerId}\u0000${path}`
      const text = overlays.get(key) ?? disk.get(key)
      if (text === undefined) throw new Error(`${path} is not a file of ${layerId}`)
      return encoder.encode(text)
    },
    locate: async () => undefined,
    async query(question) {
      questions.push(question)
      if ((question as { kind?: unknown }).kind === 'bytes') return new Uint8Array(1)
      return {
        revision: String(revision),
        documents: [
          { layerId: 'layer:0', path: 'base.sc2data/gamedata/unitdata.xml' },
          { layerId: 'layer:1', path: UNITS },
          { layerId: 'layer:9', path: 'gone.xml' },
        ],
      }
    },
    get revision() {
      return String(revision)
    },
    async overlay(batch) {
      changes.push(batch)
      for (const change of batch) {
        const key = `${change.layerId}\u0000${change.path}`
        if (change.text === undefined) overlays.delete(key)
        else overlays.set(key, change.text)
      }
      revision += 1
      return { revision: String(revision) }
    },
    async invalidate() {
      invalidations += 1
      revision += 1
      return { revision: String(revision) }
    },
    async dispose() {
      disposed = true
    },
  }
  return {
    context,
    changes,
    questions,
    get invalidations() {
      return invalidations
    },
    get disposed() {
      return disposed
    },
  }
}

const document = (uri: string, text: string, version = 1) => ({ uri, languageId: 'sc2-data', version, text })

describe('the loaded mod servers of a language workspace', () => {
  it('places a document in the layer that holds it, the opened mod on disk writable', () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    expect(servers.placeOf(MOD_UNITS_URI)).toMatchObject({ layerId: 'layer:1', path: UNITS, writable: true, gameId: 'test/game' })
    // A drive path compares without case, as Windows does; the URI's own spelling is kept.
    expect(servers.placeOf('file:///c:/mods/mine.sc2mod/base.sc2data/gamedata/unitdata.xml')).toMatchObject({
      layerId: 'layer:1',
      path: 'base.sc2data/gamedata/unitdata.xml',
    })
    expect(servers.placeOf('content-source://local%3Acasc/Mods/Core.SC2Mod/base.sc2data/gamedata/unitdata.xml')).toMatchObject({
      layerId: 'layer:0',
      path: 'base.sc2data/gamedata/unitdata.xml',
      writable: false,
    })
    expect(servers.placeOf('file:///C:/Other/UnitData.xml')).toBeUndefined()
    expect(servers.placeOf('content-source://other/Mods/Core.SC2Mod/x.xml')).toBeUndefined()
    expect(servers.placeOf(MOD_UNITS_URI, 'another/game')).toBeUndefined()
  })

  it('brings unsaved buffers to the server, not those equal to the disk, and takes closed ones away', async () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    const { scope } = servers.placeOf(MOD_UNITS_URI)!
    expect(await servers.synchronize(scope, [document(MOD_UNITS_URI, '<Catalog/>')])).toEqual({
      scope,
      gameId: 'test/game',
      revision: '0',
      complete: true,
    })
    expect(chain.changes).toEqual([])
    const edited = '<Catalog><CUnit id="Marine"/></Catalog>'
    const stock = document('content-source://local%3Acasc/Mods/Core.SC2Mod/base.sc2data/gamedata/unitdata.xml', '<edited/>')
    expect((await servers.synchronize(scope, [document(MOD_UNITS_URI, edited, 2), stock])).revision).toBe('1')
    // Only the file on disk goes over; a stock file in a content source is never written.
    expect(chain.changes).toEqual([[{ layerId: 'layer:1', path: UNITS, text: edited }]])
    await servers.synchronize(scope, [document(MOD_UNITS_URI, edited, 2)])
    expect(chain.changes).toHaveLength(1)
    // The buffer is no longer open: the server reads the file on disk again.
    expect((await servers.synchronize(scope, [])).revision).toBe('2')
    expect(chain.changes.at(-1)).toEqual([{ layerId: 'layer:1', path: UNITS }])
    await servers.synchronize(scope, [document(MOD_UNITS_URI, edited, 3)])
    await servers.release(MOD_UNITS_URI)
    expect(chain.changes.at(-1)).toEqual([{ layerId: 'layer:1', path: UNITS }])
    expect(chain.context.revision).toBe('4')
  })

  it('carries a question and gives the files an answer names their URIs', async () => {
    const chain = server()
    const servers = createLanguageModContexts({
      contexts: [chain.context],
      uriOf: target => (typeof target === 'string' ? `file:///${target}` : undefined),
    })
    const { scope } = servers.placeOf(MOD_UNITS_URI)!
    const answer = (await servers.query(scope, { kind: 'data.authoring' })) as { documents: unknown[] }
    expect(chain.questions).toEqual([{ kind: 'data.authoring' }])
    expect(answer.documents).toEqual([
      {
        layerId: 'layer:0',
        path: 'base.sc2data/gamedata/unitdata.xml',
        uri: 'content-source://local%3Acasc/Mods/Core.SC2Mod/base.sc2data/gamedata/unitdata.xml',
      },
      { layerId: 'layer:1', path: UNITS, uri: MOD_UNITS_URI },
      // A layer the chain does not have stays as named.
      { layerId: 'layer:9', path: 'gone.xml' },
    ])
    await expect(servers.query(scope, { kind: 'bytes' })).rejects.toThrow(/other than JSON/u)
    await expect(servers.query('mod-context:0:7', { kind: 'data.authoring' })).rejects.toThrow(/no loaded mod/u)
  })

  it('keeps an open context a host reopens over the same chain; a replaced one takes its buffers away', async () => {
    const first = server()
    const servers = createLanguageModContexts()
    servers.replace('mine', [first.context])
    const { scope } = servers.placeOf(MOD_UNITS_URI)!
    await servers.synchronize(scope, [document(MOD_UNITS_URI, '<edited/>')])
    // The same chain and target again: the scope a request holds stays, the new context is closed.
    const again = server()
    servers.replace('mine', [again.context])
    await servers.invalidate()
    expect(again.disposed).toBe(true)
    expect(servers.placeOf(MOD_UNITS_URI)?.scope).toBe(scope)
    // Another chain: the old context's buffer leaves its server before it closes.
    const other = server()
    Object.defineProperty(other.context, 'contextId', { value: 'another chain' })
    servers.replace('mine', [other.context])
    await servers.invalidate()
    expect(first.changes.at(-1)).toEqual([{ layerId: 'layer:1', path: UNITS }])
    expect(first.disposed).toBe(true)
    expect(servers.placeOf(MOD_UNITS_URI)?.scope).not.toBe(scope)
    await expect(servers.query(scope, { kind: 'data.authoring' })).rejects.toThrow(/no loaded mod/u)
    await servers.dispose()
    expect(other.disposed).toBe(true)
  })

  it('tells every server about files changed on disk and closes them with the workspace', async () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    const { scope } = servers.placeOf(MOD_UNITS_URI)!
    await servers.invalidate()
    expect(chain.invalidations).toBe(1)
    await servers.dispose()
    expect(chain.disposed).toBe(true)
    expect(servers.placeOf(MOD_UNITS_URI)).toBeUndefined()
    await expect(servers.query(scope, { kind: 'data.authoring' })).rejects.toThrow(/no loaded mod/u)
  })

  it('names the server in a request of a provider that asks for it, and gives the provider the port', async () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    let port: ContributionContext['modContexts']
    const seen: unknown[] = []
    const provider: LanguageProvider = {
      contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
      languageIds: ['sc2-data'],
      semanticContextRequirements: [{ kind: 'mod-context', gameId: 'test/game' }],
      analyze: async ({ document: open }) => ({
        documentUri: open.uri,
        documentVersion: open.version,
        tokens: [],
        diagnostics: [],
        symbols: [],
      }),
      async hover(request) {
        const modContext = (request as { workspaceContext?: { modContext?: { scope: string } } }).workspaceContext?.modContext
        seen.push(modContext)
        const answer = await port!.query(modContext!.scope, { kind: 'data.ids' } as JsonValue)
        return { markdown: JSON.stringify(answer) }
      },
    }
    const workspace = await languageWorkspace(provider, context => (port = context.modContexts), servers)
    const edited = '<Catalog><CUnit id="Marine"/></Catalog>'
    expect((await workspace.synchronize({ languageId: 'sc2-data', document: document(MOD_UNITS_URI, edited) })).state).toBe('resolved')
    const hover = await workspace.hover({ uri: MOD_UNITS_URI, documentVersion: 1, position: { line: 0, character: 1 } })
    const { scope } = servers.placeOf(MOD_UNITS_URI)!
    expect(seen).toEqual([{ scope, gameId: 'test/game', revision: '1', complete: true }])
    expect(chain.changes).toEqual([[{ layerId: 'layer:1', path: UNITS, text: edited }]])
    expect(JSON.parse(hover!.markdown)).toMatchObject({ revision: '1' })
    expect(chain.questions).toEqual([{ kind: 'data.ids' }])
    await workspace.close(MOD_UNITS_URI)
    expect(chain.changes.at(-1)).toEqual([{ layerId: 'layer:1', path: UNITS }])
    await workspace.shutdown()
  }, 30_000)
})

/** A workspace over one linked in-process provider, which sees the context it is activated with. */
async function languageWorkspace(
  provider: LanguageProvider,
  activated: (context: ContributionContext) => void,
  servers: ReturnType<typeof createLanguageModContexts>,
) {
  const extension = defineLinkedExtension({
    source: 'linked:test/mod-contexts',
    packageJson: {
      name: 'test-mod-contexts',
      version: '1.0.0',
      license: 'MIT',
      type: 'module',
      description: 'Mod server language fixture',
      modkit: {
        schemaVersion: 1,
        publisher: 'org.modkit.test',
        id: 'mod-contexts',
        contributionManifests: ['./contributions/language.json'],
      },
    },
    contributions: [
      {
        path: 'contributions/language.json',
        manifest: {
          schemaVersion: 1,
          contract: { id: 'org.modkitx/service-provider-contribution', major: 1 },
          id: 'org.modkit.test/mod-contexts-provider',
          displayName: 'Mod server language',
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
                offerId: 'language',
                contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
                major: 1,
                version: '1.0.0',
                facet: { languageIds: ['sc2-data'] },
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
        createProvider: (_selection: unknown, context: ContributionContext) => {
          activated(context)
          return { value: provider, release: async () => undefined }
        },
      },
    },
  })
  const linked = linkedExtensionInputs([extension])
  const composition = await createHostComposition({
    topology: createHostTopology({
      schemaVersion: 1,
      topologyId: 'org.modkit.test/mod-contexts',
      realms: [
        {
          schemaVersion: 1,
          realmId: 'org.modkit.test/mod-contexts',
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
          policy: { id: 'org.modkit.test/mod-contexts-policy', revision: '1' },
        },
      ],
      links: [],
    }),
    realmId: 'org.modkit.test/mod-contexts',
    extensions: linked.inputs,
    executionBackends: createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)]),
  })
  const definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
  const workspace = createLanguageWorkspace({
    services: { ...composition, serviceDefinitions: definitions },
    grant: { id: 'mod-contexts-test', classes: [] },
    budgets: {
      maxInputBytes: 1000000n,
      maxDepth: 64,
      maxNodes: 100000,
      maxScalarBytes: 1000000,
      maxDiagnostics: 100,
    },
    modContexts: servers,
  })
  await workspace.initialize()
  return workspace
}
