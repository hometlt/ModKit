/**
 * The loaded mods' servers of a language workspace (owner decision 07.10): a document placed in
 * the chain that holds it, the editor's unsaved buffers brought to that server before a request
 * reads it and taken away when they close, a provider's questions carried there with the files the
 * answer names given the URIs the host uses, and every server told when files change on disk.
 */
import { describe, expect, it, vi } from 'vitest'
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
import type { LanguageWorkspaceOptions } from '../src/language/workspace.js'

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
      {
        id: 'layer:0',
        displayName: 'Core.SC2Mod',
        sourceId: 'local:casc',
        sourcePath: 'Mods/Core.SC2Mod',
        role: 'dependency',
        provenance: 'implicit',
        kind: 'package',
      },
      {
        id: 'layer:1',
        displayName: 'Mine.SC2Mod',
        sourceId: 'host',
        sourcePath: 'C:/Mods/Mine.SC2Mod',
        role: 'primary',
        provenance: 'opened',
        kind: 'package',
      },
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
      // An empty overlay only asks the revision, as the contract says.
      if (batch.length === 0) return { revision: String(revision) }
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

const document = (uri: string, text: string, version = 1) => ({
  uri,
  languageId: 'sc2-data',
  version,
  text,
})

describe('the loaded mod servers of a language workspace', () => {
  it('retries unchanged buffers after a rejected overlay delivery', async () => {
    const chain = server()
    let attempts = 0
    const context: ModContext = { ...chain.context, overlay: async changes => {
      if (++attempts === 1) throw new Error('delivery refused')
      return chain.context.overlay!(changes)
    } }
    const servers = createLanguageModContexts({ contexts: [context] })
    const scope = servers.placeOf(MOD_UNITS_URI)!.scope
    const buffer = document(MOD_UNITS_URI, '<Catalog><CUnit id="Mine"/></Catalog>')
    try {
      await expect(servers.synchronize(scope, [buffer])).rejects.toThrow('delivery refused')
      await servers.synchronize(scope, [buffer])
      expect(attempts).toBe(2)
      expect(new TextDecoder().decode(await chain.context.read('layer:1', UNITS, 1024))).toBe(buffer.text)
    } finally { await servers.dispose() }
  })

  it.each(['release', 'synchronize'] as const)('retries a failed closed-buffer removal through %s', async method => {
    const chain = server()
    let rejectRemoval = true
    const context: ModContext = { ...chain.context, overlay: async changes => {
      if (changes.some(change => change.text === undefined) && rejectRemoval) {
        rejectRemoval = false
        throw new Error('removal refused')
      }
      return chain.context.overlay!(changes)
    } }
    const servers = createLanguageModContexts({ contexts: [context] })
    const scope = servers.placeOf(MOD_UNITS_URI)!.scope
    try {
      await servers.synchronize(scope, [document(MOD_UNITS_URI, '<Catalog><CUnit id="Mine"/></Catalog>')])
      const remove = () => method === 'release' ? servers.release(MOD_UNITS_URI) : servers.synchronize(scope, [])
      await expect(remove()).rejects.toThrow('removal refused')
      await remove()
      expect(new TextDecoder().decode(await chain.context.read('layer:1', UNITS, 1024))).toBe('<Catalog/>')
    } finally { await servers.dispose() }
  })

  it('rechecks a previously clean buffer after saved files change, preserving unsaved removal authority', async () => {
    const chain = server()
    let saved = '<Catalog/>'
    const context: ModContext = { ...chain.context, read: async (layer, path, maximum) => {
      const text = new TextDecoder().decode(await chain.context.read(layer, path, maximum))
      return encoder.encode(text === '<Catalog/>' ? saved : text)
    } }
    const servers = createLanguageModContexts({ contexts: [context] })
    const scope = servers.placeOf(MOD_UNITS_URI)!.scope
    const clean = document(MOD_UNITS_URI, saved)
    try {
      await servers.synchronize(scope, [clean])
      expect(chain.changes).toHaveLength(0)
      saved = '<Catalog><CUnit id="External"/></Catalog>'
      await servers.invalidate()
      await servers.synchronize(scope, [clean])
      expect(chain.changes).toEqual([[{ layerId: 'layer:1', path: UNITS, text: clean.text }]])
      await servers.invalidate()
      await servers.synchronize(scope, [clean])
      expect(chain.changes).toHaveLength(1)
      await servers.release(MOD_UNITS_URI)
      expect(chain.changes.at(-1)).toEqual([{ layerId: 'layer:1', path: UNITS }])
    } finally { await servers.dispose() }
  })

  it('settles every source invalidation before the next queued buffer sync even when one fails', async () => {
    const first = server()
    const second = server()
    let finish!: () => void
    const waiting = new Promise<{ revision: string }>(resolve => { finish = () => resolve({ revision: '1' }) })
    const servers = createLanguageModContexts({ contexts: [
      { ...first.context, invalidate: async () => { throw new Error('first source failed') } },
      { ...second.context, contextId: 'other', invalidate: () => waiting },
    ] })
    const refreshed = servers.invalidate()
    let rejected = false
    void refreshed.catch(() => { rejected = true })
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(rejected).toBe(false)
      finish()
      await expect(refreshed).rejects.toThrow('first source failed')
    } finally { finish(); await servers.dispose() }
  })

  it('keeps distinct case-sensitive content roots separate', async () => {
    const chain = server()
    const upper = { ...chain.context.layers[0]!, caseSensitive: true }
    const lower = { ...upper, id: 'layer:lower', sourcePath: 'mods/core.sc2mod' }
    const servers = createLanguageModContexts({
      contexts: [{ ...chain.context, layers: [upper, lower] }],
    })
    expect(
      servers.placeOf('content-source://local%3Acasc/Mods/Core.SC2Mod/UnitData.xml'),
    ).toMatchObject({ layerId: 'layer:0', path: 'UnitData.xml' })
    expect(
      servers.placeOf('content-source://local%3Acasc/mods/core.sc2mod/UnitData.xml'),
    ).toMatchObject({ layerId: 'layer:lower', path: 'UnitData.xml' })
    expect(
      servers.placeOf('content-source://local%3Acasc/MODS/CORE.SC2MOD/UnitData.xml'),
    ).toBeUndefined()
    await servers.dispose()
  })

  it.each([undefined, false])(
    'keeps v1 content-source aliases when caseSensitive is %s',
    async caseSensitive => {
      const chain = server()
      const servers = createLanguageModContexts({
        contexts: [
          {
            ...chain.context,
            layers: [
              {
                ...chain.context.layers[0]!,
                ...(caseSensitive === undefined ? {} : { caseSensitive }),
              },
            ],
          },
        ],
      })
      expect(
        servers.placeOf('content-source://local%3Acasc/mods/core.sc2mod/UnitData.xml'),
      ).toMatchObject({ layerId: 'layer:0', path: 'UnitData.xml' })
      await servers.dispose()
    },
  )

  it('serves opted-in hover without a snapshot, preserving locale inputs, overlays and dependency revisions', async () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    let locales = ['enUS', 'ruRU']
    let incomplete = false
    let snapshots = 0
    const seen: unknown[] = []
    const provider: LanguageProvider = {
      contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
      languageIds: ['sc2-data'],
      modContextFeatures: ['hover'],
      semanticContextRequirements: [{ kind: 'mod-context', gameId: 'test/game' }],
      analyze: async ({ document: open }) => ({
        documentUri: open.uri,
        documentVersion: open.version,
        tokens: [],
        diagnostics: [],
        symbols: [],
      }),
      async hover(request) {
        expect(request.workspaceDocuments).toEqual([request.document])
        expect(request.workspaceIncomplete).toBe(incomplete)
        expect(request.workspaceContext?.semanticComplete).toBe(!incomplete)
        expect(request.workspaceContext?.semanticInputs).toContainEqual({
          kind: 'locale-set',
          id: 'locale',
          revision: '1',
          payload: { locales },
        })
        seen.push(request.workspaceContext?.modContext)
        return { markdown: `${request.workspaceContext?.modContext?.revision}:${locales[0]}` }
      },
    }
    const workspace = await languageWorkspace(provider, () => {}, servers, {
      semanticInputs: () => [
        { kind: 'locale-set', id: 'locale', revision: '1', payload: { locales } },
      ],
      workspaceIncomplete: () => incomplete,
      documentSource: {
        async snapshot() {
          snapshots += 1
          throw new Error('hover must use the model')
        },
      },
    })
    await workspace.synchronize({
      languageId: 'sc2-data',
      document: document(MOD_UNITS_URI, '<edited/>'),
    })
    const request = {
      uri: MOD_UNITS_URI,
      documentVersion: 1,
      position: { line: 0, character: 1 },
      maxDocuments: 1,
    }
    expect(await workspace.hover(request)).toMatchObject({ markdown: '1:enUS' })
    expect(await workspace.hover(request)).toMatchObject({ markdown: '1:enUS' })
    expect(chain.changes).toHaveLength(1)
    locales = ['ruRU', 'enUS']
    expect(await workspace.hover(request)).toMatchObject({ markdown: '1:ruRU' })
    await servers.invalidate()
    expect(await workspace.hover(request)).toMatchObject({ markdown: '2:ruRU' })
    expect(seen).toHaveLength(4)
    incomplete = true
    expect(await workspace.hover(request)).toMatchObject({ markdown: '2:ruRU' })
    expect(snapshots).toBe(0)
    await workspace.shutdown()
  }, 30_000)

  it('serves opted-in definition and references from the server with the document place, or a snapshot where the provider declines', async () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    let snapshots = 0
    let applies = true
    const asked: string[] = []
    const occurrences = vi.fn(async () => [])
    const location = (uri: string) => ({ uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } })
    const provider: LanguageProvider = {
      contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
      languageIds: ['sc2-data'],
      modContextFeatures: ['definition', 'references'],
      semanticContextRequirements: [{ kind: 'mod-context', gameId: 'test/game' }],
      analyze: async ({ document: open }) => ({
        documentUri: open.uri,
        documentVersion: open.version,
        tokens: [],
        diagnostics: [],
        symbols: [],
      }),
      async modContextFeatureApplies(request) {
        asked.push(request.feature)
        return applies
      },
      referenceOccurrences: occurrences,
      async definition(request) {
        return { locations: [location(snapshots > 0 ? 'snapshot:' : 'served:')], isIncomplete: false }
      },
      async references(request) {
        // Both paths name the document's place in the chain; only the served one skips the snapshot.
        const place = request.workspaceContext?.modContext?.document
        if (snapshots === 0) expect(request.workspaceDocuments).toEqual([request.document])
        return {
          locations: [location(snapshots > 0 ? 'snapshot:' : `served:${place?.layerId}/${place?.path}`)],
          isIncomplete: false,
        }
      },
    }
    const workspace = await languageWorkspace(provider, () => {}, servers, {
      documentSource: {
        async snapshot() {
          snapshots += 1
          return { documents: [], isComplete: true }
        },
      },
    })
    await workspace.synchronize({ languageId: 'sc2-data', document: document(MOD_UNITS_URI, '<edited/>') })
    const request = { uri: MOD_UNITS_URI, documentVersion: 1, position: { line: 0, character: 1 } }
    expect((await workspace.definition(request))?.locations.map(item => item.uri)).toEqual(['served:'])
    const references = await workspace.references({ ...request, includeDeclaration: true })
    expect(references?.locations[0]?.uri).toBe(`served:layer:1/${UNITS}`)
    expect(snapshots).toBe(0)
    // The typed index is built from snapshot occurrences; a served request has none to give.
    expect(occurrences).not.toHaveBeenCalled()
    expect(asked).toEqual(['definition', 'references'])
    applies = false
    expect((await workspace.references({ ...request, includeDeclaration: true }))?.locations.map(item => item.uri))
      .toEqual(['snapshot:'])
    expect(snapshots).toBe(1)
    expect(occurrences).toHaveBeenCalled()
    await workspace.shutdown()
  }, 30_000)

  it('serves opted-in hover and signature help from the server, or a snapshot where the provider declines', async () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    let snapshots = 0
    let applies = true
    const asked: string[] = []
    const source = (request: { readonly workspaceDocuments: readonly unknown[]; readonly document: unknown }) =>
      snapshots > 0 ? 'snapshot' : request.workspaceDocuments.length === 1 ? 'served' : 'unexpected'
    const provider: LanguageProvider = {
      contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
      languageIds: ['sc2-data'],
      modContextFeatures: ['hover', 'signatureHelp'],
      semanticContextRequirements: [{ kind: 'mod-context', gameId: 'test/game' }],
      analyze: async ({ document: open }) => ({
        documentUri: open.uri,
        documentVersion: open.version,
        tokens: [],
        diagnostics: [],
        symbols: [],
      }),
      async modContextFeatureApplies(request) {
        asked.push(request.feature)
        return applies
      },
      async hover(request) {
        const place = request.workspaceContext?.modContext?.document
        return { markdown: `${source(request)}:${place?.layerId ?? ''}` }
      },
      async signatureHelp(request) {
        return { signatures: [{ label: source(request), parameters: [] }], activeSignature: 0, activeParameter: 0 }
      },
    }
    const workspace = await languageWorkspace(provider, () => {}, servers, {
      documentSource: {
        async snapshot() {
          snapshots += 1
          return { documents: [], isComplete: true }
        },
      },
    })
    await workspace.synchronize({ languageId: 'sc2-data', document: document(MOD_UNITS_URI, '<edited/>') })
    const request = { uri: MOD_UNITS_URI, documentVersion: 1, position: { line: 0, character: 1 } }
    expect((await workspace.hover(request))?.markdown).toBe('served:layer:1')
    expect((await workspace.signatureHelp(request))?.signatures[0]?.label).toBe('served')
    expect(snapshots).toBe(0)
    expect(asked).toEqual(['hover', 'signatureHelp'])
    applies = false
    expect((await workspace.signatureHelp(request))?.signatures[0]?.label).toBe('snapshot')
    expect(snapshots).toBe(1)
    await workspace.shutdown()
  }, 30_000)

  it("serves an opted-in document's diagnostics from the server without a position proof", async () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    let snapshots = 0
    const asked: string[] = []
    const provider: LanguageProvider = {
      contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
      languageIds: ['sc2-data'],
      modContextFeatures: ['diagnostics'],
      semanticContextRequirements: [{ kind: 'mod-context', gameId: 'test/game' }],
      analyze: async ({ document: open }) => ({
        documentUri: open.uri,
        documentVersion: open.version,
        tokens: [],
        diagnostics: [],
        symbols: [],
      }),
      async modContextFeatureApplies(request) {
        asked.push(request.feature)
        return false
      },
      async diagnostics(request) {
        const place = request.workspaceContext?.modContext?.document
        const served = request.workspaceDocuments.length === 1 && place !== undefined
        return {
          diagnostics: [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 'warning',
            message: served ? `served:${place.layerId}` : 'snapshot',
          }],
          isIncomplete: false,
        }
      },
    }
    const workspace = await languageWorkspace(provider, () => {}, servers, {
      documentSource: {
        async snapshot() {
          snapshots += 1
          return { documents: [], isComplete: true }
        },
      },
    })
    await workspace.synchronize({ languageId: 'sc2-data', document: document(MOD_UNITS_URI, '<edited/>') })
    const report = await workspace.diagnostics({ uri: MOD_UNITS_URI, documentVersion: 1 })
    expect(report?.diagnostics.map(item => item.message)).toEqual(['served:layer:1'])
    // No snapshot, and no position-specific proof is asked of a whole document's diagnostics.
    expect(snapshots).toBe(0)
    expect(asked).toEqual([])
    await workspace.shutdown()
  }, 30_000)

  it('keeps bounded snapshots for standalone hover and rejects answers after a server revision changes', async () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    let snapshots = 0
    const provider: LanguageProvider = {
      contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
      languageIds: ['sc2-data'],
      modContextFeatures: ['hover'],
      semanticContextRequirements: [{ kind: 'mod-context', gameId: 'test/game' }],
      analyze: async ({ document: open }) => ({
        documentUri: open.uri,
        documentVersion: open.version,
        tokens: [],
        diagnostics: [],
        symbols: [],
      }),
      async hover(request) {
        if (request.workspaceContext?.modContext !== undefined) await servers.invalidate()
        return { markdown: 'answer' }
      },
    }
    const workspace = await languageWorkspace(provider, () => {}, servers, {
      documentSource: {
        async snapshot() {
          snapshots += 1
          return { documents: [], isComplete: false }
        },
      },
    })
    const standalone = 'file:///C:/Other/UnitData.xml'
    await workspace.synchronize({
      languageId: 'sc2-data',
      document: document(standalone, '<Catalog/>'),
    })
    expect(
      await workspace.hover({
        uri: standalone,
        documentVersion: 1,
        position: { line: 0, character: 1 },
      }),
    ).toMatchObject({ markdown: 'answer' })
    expect(snapshots).toBe(1)
    await workspace.synchronize({
      languageId: 'sc2-data',
      document: document(MOD_UNITS_URI, '<Catalog/>'),
    })
    await expect(
      workspace.hover({
        uri: MOD_UNITS_URI,
        documentVersion: 1,
        position: { line: 0, character: 1 },
      }),
    ).rejects.toThrow('operation cancelled')
    expect(snapshots).toBe(1)
    await workspace.shutdown()
  }, 30_000)

  it('serves retained completion and keeps position-specific and standalone snapshots', async () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    let snapshots = 0
    let applies: unknown = true
    let changeRevision = false
    let proofs = 0
    const provider: LanguageProvider = {
      contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
      languageIds: ['sc2-data'],
      modContextFeatures: ['hover', 'completion'],
      semanticContextRequirements: [{ kind: 'mod-context', gameId: 'test/game' }],
      analyze: async ({ document: open }) => ({
        documentUri: open.uri,
        documentVersion: open.version,
        tokens: [],
        diagnostics: [],
        symbols: [],
      }),
      async modContextCompletionApplies(request) {
        proofs += 1
        expect(request.position).toEqual({ line: 0, character: 1 })
        return applies as boolean
      },
      hover: async () => ({ markdown: 'hover' }),
      async completion(request) {
        if (applies === true && request.document.uri === MOD_UNITS_URI) {
          expect(request.workspaceDocuments).toEqual([request.document])
        }
        if (changeRevision) await servers.invalidate()
        return {
          items: [
            { label: request.workspaceContext?.modContext?.revision ?? 'standalone', kind: 'field' },
          ],
          isIncomplete: false,
        }
      },
    }
    const workspace = await languageWorkspace(provider, () => {}, servers, {
      documentSource: {
        async snapshot() {
          snapshots += 1
          return { documents: [], isComplete: false }
        },
      },
    })
    try {
      await workspace.synchronize({
        languageId: 'sc2-data',
        document: document(MOD_UNITS_URI, '<edited/>'),
      })
      const request = { uri: MOD_UNITS_URI, documentVersion: 1, position: { line: 0, character: 1 } }
      for (const semanticContextPolicy of ['fresh', 'cached'] as const) {
        expect(await workspace.completion({ ...request, semanticContextPolicy })).toMatchObject({
          items: [{ label: '1' }],
        })
      }
      expect(snapshots).toBe(0)
      expect(chain.changes).toHaveLength(1)
      expect(proofs).toBe(2)
      expect(await workspace.hover(request)).toMatchObject({ markdown: 'hover' })
      expect(proofs).toBe(2)
      expect(snapshots).toBe(0)
      applies = false
      await workspace.completion(request)
      expect(snapshots).toBe(1)
      applies = 'invalid'
      await expect(workspace.completion(request)).rejects.toThrow(
        'invalid ModContext completion applicability',
      )
      expect(snapshots).toBe(1)
      applies = true
      const standalone = 'file:///C:/Other/UnitData.xml'
      await workspace.synchronize({
        languageId: 'sc2-data',
        document: document(standalone, '<Catalog/>'),
      })
      expect(await workspace.completion({ ...request, uri: standalone })).toMatchObject({
        items: [{ label: 'standalone' }],
      })
      expect(snapshots).toBe(2)
      changeRevision = true
      await expect(workspace.completion(request)).rejects.toThrow('operation cancelled')
      expect(snapshots).toBe(2)
    } finally {
      await workspace.shutdown()
    }
  }, 30_000)

  it('places a document in the layer that holds it, the opened mod on disk writable', () => {
    const chain = server()
    const servers = createLanguageModContexts({ contexts: [chain.context] })
    expect(servers.placeOf(MOD_UNITS_URI)).toMatchObject({
      layerId: 'layer:1',
      path: UNITS,
      writable: true,
      gameId: 'test/game',
    })
    // A drive path compares without case, as Windows does; the URI's own spelling is kept.
    expect(
      servers.placeOf('file:///c:/mods/mine.sc2mod/base.sc2data/gamedata/unitdata.xml'),
    ).toMatchObject({
      layerId: 'layer:1',
      path: 'base.sc2data/gamedata/unitdata.xml',
    })
    expect(
      servers.placeOf(
        'content-source://local%3Acasc/Mods/Core.SC2Mod/base.sc2data/gamedata/unitdata.xml',
      ),
    ).toMatchObject({
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
    const stock = document(
      'content-source://local%3Acasc/Mods/Core.SC2Mod/base.sc2data/gamedata/unitdata.xml',
      '<edited/>',
    )
    expect(
      (await servers.synchronize(scope, [document(MOD_UNITS_URI, edited, 2), stock])).revision,
    ).toBe('1')
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
    const answer = (await servers.query(scope, { kind: 'data.authoring' })) as {
      documents: unknown[]
    }
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
    await expect(servers.query('mod-context:0:7', { kind: 'data.authoring' })).rejects.toThrow(
      /no loaded mod/u,
    )
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

  it('replaces a lost transport generation even when the chain and session identity stay the same', async () => {
    const first = server()
    Object.defineProperty(first.context, 'generation', { value: 'connection-1' })
    const contexts = createLanguageModContexts()
    contexts.replace('mine', [first.context])
    const { scope } = contexts.placeOf(MOD_UNITS_URI)!
    await contexts.synchronize(scope, [document(MOD_UNITS_URI, '<edited/>')])
    Object.defineProperty(first.context, 'overlay', { value: async () => { throw new Error('transport gone') } })
    const next = server()
    Object.defineProperty(next.context, 'generation', { value: 'connection-2' })
    contexts.replace('mine', [next.context])
    const placed = contexts.placeOf(MOD_UNITS_URI)!
    expect(placed.scope).not.toBe(scope)
    await contexts.synchronize(placed.scope, [document(MOD_UNITS_URI, '<edited/>')])
    expect(first.disposed).toBe(true)
    expect(next.disposed).toBe(false)
    expect(next.changes.at(-1)).toEqual([{ layerId: 'layer:1', path: UNITS, text: '<edited/>' }])
    await contexts.dispose()
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
        const modContext = (request as { workspaceContext?: { modContext?: { scope: string } } })
          .workspaceContext?.modContext
        seen.push(modContext)
        const answer = await port!.query(modContext!.scope, { kind: 'data.ids' } as JsonValue)
        return { markdown: JSON.stringify(answer) }
      },
    }
    const workspace = await languageWorkspace(
      provider,
      context => (port = context.modContexts),
      servers,
    )
    const edited = '<Catalog><CUnit id="Marine"/></Catalog>'
    expect(
      (
        await workspace.synchronize({
          languageId: 'sc2-data',
          document: document(MOD_UNITS_URI, edited),
        })
      ).state,
    ).toBe('resolved')
    const hover = await workspace.hover({
      uri: MOD_UNITS_URI,
      documentVersion: 1,
      position: { line: 0, character: 1 },
    })
    const { scope } = servers.placeOf(MOD_UNITS_URI)!
    expect(seen).toEqual([
      { scope, gameId: 'test/game', revision: '1', complete: true, document: { layerId: 'layer:1', path: UNITS } },
    ])
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
  options: Partial<LanguageWorkspaceOptions> = {},
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
    ...options,
  })
  await workspace.initialize()
  return workspace
}
