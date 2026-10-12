import { describe, expect, it, vi } from 'vitest'
import type {
  ContentSources,
  ModContext,
  ModContextLayer,
  ModContextRequest,
} from '@modkit/vfs/content-sources'
import type { LanguageWorkspaceDocumentSource } from '../src/language/workspace.js'
import {
  baseModsFor,
  composeLanguageDocumentSources,
  resolveContentAssetOrigins,
  resolveContentLanguageSources,
  resolveSubjectClosure,
  subjectTarget,
} from '../src/content-dependency-operations.js'

function sources(openModContext?: ContentSources['openModContext']): ContentSources {
  return {
    async snapshot() {
      return { label: 'test', regions: [], connections: [], roots: [] }
    },
    async connect() {},
    async disconnect() {},
    async search() {
      return []
    },
    async add() {},
    async remove() {},
    async refresh() {},
    async list() {
      return []
    },
    async read() {
      return new Uint8Array()
    },
    ...(openModContext === undefined ? {} : { openModContext }),
    async dispose() {},
  }
}

/** A context whose layers are the given ones, then the opened subject. */
function context(request: ModContextRequest, layers: readonly ModContextLayer[], dispose = vi.fn(async () => {})): ModContext {
  const target = typeof request.target === 'string' ? request.target : request.target.path
  return {
    schemaVersion: 1,
    gameId: 'example/game',
    contextId: 'context',
    layers: [
      ...layers,
      { id: 'primary', displayName: 'subject', sourceId: 'host', sourcePath: target, role: 'primary', provenance: 'opened' },
    ],
    unresolved: [],
    diagnostics: [],
    files: async () => ({ items: [] }),
    read: async () => new Uint8Array(),
    locate: async () => undefined,
    dispose,
  }
}

const core: ModContextLayer = { id: 'l0', displayName: 'Core', sourceId: 'casc', sourcePath: 'Mods/Core', role: 'dependency', provenance: 'implicit' }
const base: ModContextLayer = { id: 'l1', displayName: 'Base', sourceId: 'casc', sourcePath: 'Mods/Base', role: 'base', provenance: 'setting' }
const wizards: ModContextLayer = { id: 'l2', displayName: 'wizards', sourceId: 'wizards', sourcePath: '', role: 'dependency', provenance: 'setting' }
const sibling: ModContextLayer = { id: 'l3', displayName: 'Assets', sourceId: 'host', sourcePath: 'C:/Work/Assets.SC2Mod', role: 'dependency', provenance: 'declared' }

describe('subject closures through mod contexts', () => {
  it('omits the parallel chain source only when the caller retains an authoritative query server', async () => {
    const openModContext = vi.fn(async (request: ModContextRequest): Promise<ModContext> => ({ ...context(request, [core]),
      languageModel: 'server', query: async () => ({}) }))
    const request = { contentSources: sources(openModContext), routes: [],
      limits: { maxDocumentBytes: 1024, maxWorkspaceBytes: 4096, maxEntries: 8 },
      subjects: [{ descriptor: { subjectUri: 'file:///C:/one' } }] }
    const served = await resolveContentLanguageSources({ ...request, keepContexts: true })
    expect(served.sources).toEqual([])
    expect(served.contexts).toHaveLength(1)
    expect(served.dependenciesComplete).toBe(true)
    const standalone = await resolveContentLanguageSources(request)
    expect(standalone.sources).toHaveLength(1)
    const legacy = await resolveContentLanguageSources({ ...request, keepContexts: true,
      contentSources: sources(async request => ({ ...context(request, [core]), languageModel: 'server' })) })
    expect(legacy.sources).toHaveLength(1)
    await Promise.all(served.contexts!.map(context => context.dispose()))
    await Promise.all(legacy.contexts!.map(context => context.dispose()))
  })

  it('forwards one explicit workspace scope to every subject in a language projection', async () => {
    const openModContext = vi.fn(async (request: ModContextRequest) => context(request, [core]))
    await resolveContentLanguageSources({
      contentSources: sources(openModContext), routes: [],
      limits: { maxDocumentBytes: 1024, maxWorkspaceBytes: 4096, maxEntries: 8 },
      subjects: [{ descriptor: { subjectUri: 'file:///C:/one' } }, { descriptor: { subjectUri: 'file:///C:/two' } }],
      sessionId: 'workspace-a',
    })
    expect(openModContext.mock.calls.map(([request]) => request.sessionId)).toEqual(['workspace-a', 'workspace-a'])
  })
  it('names a host path for file: URIs and a source path for content-source: URIs', () => {
    expect(subjectTarget('file:///C:/Work/Scripts/My%20Script.galaxy')).toBe('C:/Work/Scripts/My Script.galaxy')
    expect(subjectTarget('content-source://local%3Acasc/Mods/Liberty.SC2Mod/Base.SC2Data')).toEqual({
      sourceId: 'local:casc',
      path: 'Mods/Liberty.SC2Mod/Base.SC2Data',
    })
    expect(subjectTarget('memory://subject')).toBeUndefined()
    expect(subjectTarget(undefined)).toBeUndefined()
  })

  it('projects each subject context into language sources and reports one that fails to open', async () => {
    const openModContext = vi.fn(async (request: ModContextRequest) => {
      if (request.target === 'C:/broken') throw new Error('loader exploded')
      return context(request, [core])
    })
    const projected = await resolveContentLanguageSources({
      contentSources: sources(openModContext),
      routes: [],
      limits: { maxDocumentBytes: 1024, maxWorkspaceBytes: 4096, maxEntries: 16 },
      subjects: [
        { descriptor: { subjectUri: 'file:///C:/good' } },
        { descriptor: {}, target: 'C:/broken' },
      ],
    })
    expect(openModContext).toHaveBeenCalledTimes(2)
    expect(projected.sources).toHaveLength(1)
    expect(projected.dependenciesComplete).toBe(false)
    expect(projected.diagnostics).toMatchObject([
      { code: 'x3.host/mod-context-failed', message: 'loader exploded' },
    ])
  })

  it('reports a subject no source can open and a provider without contexts', async () => {
    await expect(
      resolveSubjectClosure({ contentSources: sources(vi.fn()), subject: { descriptor: { subjectUri: 'memory://x' } } }),
    ).resolves.toMatchObject({ diagnostics: [{ code: 'x3.host/mod-context-target-unavailable' }] })
    await expect(
      resolveSubjectClosure({ contentSources: sources(), subject: { descriptor: {}, target: 'C:/x' } }),
    ).resolves.toMatchObject({ diagnostics: [{ code: 'x3.host/mod-context-unavailable' }] })
  })

  it('rebases an open overlay after weaker dependency layers', async () => {
    const dependencyUri = 'content-source://fixture/base/GameData/UnitData.xml'
    const openUri = 'file:///workspace/GameData/UnitData.xml'
    const localOrigin = {
      uri: openUri,
      layerId: 'local',
      logicalId: 'GameData/UnitData.xml',
      precedence: 0,
      sourceRevision: 'open:2',
      readOnly: false,
      overlay: true,
    } as const
    const dependency: LanguageWorkspaceDocumentSource = {
      snapshot: async () => ({
        documents: [{ uri: dependencyUri, languageId: 'sc2-data', version: 1, text: '<Catalog/>' }],
        isComplete: true,
        workspaceContext: {
          id: 'dependency-context',
          revision: 'dependency:1',
          semanticComplete: true,
          documentOrigins: [
            {
              uri: dependencyUri,
              layerId: 'dependency',
              logicalId: 'GameData/UnitData.xml',
              precedence: 0,
              sourceRevision: 'dependency:1',
              readOnly: true,
            },
          ],
        },
      }),
    }
    const local: LanguageWorkspaceDocumentSource = {
      snapshot: async () => ({
        documents: [],
        isComplete: true,
        workspaceContext: {
          id: 'local-context',
          revision: 'local:1',
          semanticComplete: true,
          documentOrigins: [localOrigin],
        },
      }),
    }
    const source = composeLanguageDocumentSources([dependency, local])
    const document = { uri: openUri, languageId: 'sc2-data', version: 2, text: '<Catalog/>' }
    const result = await source!.snapshot({
      document,
      workspaceDocuments: [document],
      workspaceDocumentOrigins: [localOrigin],
      workspaceLanguageIds: ['sc2-data'],
      maxDocuments: 8,
      signal: new AbortController().signal,
    })
    expect(result.workspaceContext).toMatchObject({
      semanticComplete: true,
      documentOrigins: [
        { uri: openUri, precedence: 1, layerId: 'local', overlay: true },
        { uri: dependencyUri, precedence: 0, layerId: 'dependency', readOnly: true },
      ],
    })
  })

  it('opens a file subject inside its mods, with the base the setting names for its path', async () => {
    const opened: ModContextRequest[] = []
    const dispose = vi.fn(async () => {})
    const openModContext = vi.fn(async (request: ModContextRequest): Promise<ModContext> => {
      opened.push(request)
      return context(request, [core, base, wizards, sibling], dispose)
    })
    const baseMods = { '*': ['Mods/Void'], 'C:\\Work\\Scripts': ['Mods/Base'], 'C:/Work/Scripts2': ['Mods/Other'] }
    const origins = await resolveContentAssetOrigins({
      contentSources: sources(openModContext),
      subjects: [{ descriptor: { subjectUri: 'file:///C:/Work/Scripts/My%20Script.galaxy' } }],
      baseMods,
    })
    expect(opened).toEqual([
      { schemaVersion: 1, target: 'C:/Work/Scripts/My Script.galaxy', baseMods: ['Mods/Base'] },
    ])
    expect(dispose).toHaveBeenCalledOnce()
    // one origin over the context's content-source layers
    expect(origins.origins).toHaveLength(1)
    expect(origins.dependenciesComplete).toBe(true)
    const closure = await resolveSubjectClosure({
      contentSources: sources(openModContext),
      subject: { descriptor: {}, target: { sourceId: 'local:documents', path: 'Scripts/Tool.galaxy' } },
      baseMods,
    })
    // a path inside a source takes only the '*' base; the subject and host layers are no mounts
    expect(opened.at(-1)).toEqual({
      schemaVersion: 1,
      target: { sourceId: 'local:documents', path: 'Scripts/Tool.galaxy' },
      baseMods: ['Mods/Void'],
    })
    expect(closure.resolution?.mounts.map(mount => [mount.sourceId, mount.sourcePath, mount.kind])).toEqual([
      ['casc', 'Mods/Core', 'dependency'],
      ['casc', 'Mods/Base', 'base'],
      ['wizards', '', 'dependency'],
    ])
  })

  it('picks the longest setting key that holds a path', () => {
    const setting = { '*': ['any'], 'C:/A': ['a'], 'c:\\a\\b': ['b'], 'C:/A/b.txt': ['file'] }
    expect(baseModsFor('C:/A/b/c.galaxy', setting)).toEqual(['b'])
    expect(baseModsFor('C:/A/b.txt', setting)).toEqual(['file'])
    expect(baseModsFor('C:/A/bc/x', setting)).toEqual(['a'])
    expect(baseModsFor('D:/x', setting)).toEqual(['any'])
    expect(baseModsFor('D:/x', undefined)).toBeUndefined()
  })
})
