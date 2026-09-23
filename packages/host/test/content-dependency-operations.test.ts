import { describe, expect, it, vi } from 'vitest'
import { operationId } from '@modkit/core'
import type { AnyDescriptor, OperationSession } from '@modkit/sdk'
import type { ContentSources, ModContext, ModContextRequest } from '@modkit/vfs/content-sources'
import type { LanguageWorkspaceDocumentSource } from '../src/language/workspace.js'
import {
  analyzeOperationContentDependencies,
  baseModsFor,
  composeLanguageDocumentSources,
  readOperationContentDependencies,
  resolveContentAssetOrigins,
  resolveContentLanguageSources,
} from '../src/content-dependency-operations.js'

const dependencySet = Object.freeze({
  schemaVersion: 1 as const,
  gameId: 'example/game',
  complete: true,
  dependencies: Object.freeze([{ id: 'base' }]),
})

function descriptor(
  state: 'available' | 'disabled' = 'available',
): Pick<AnyDescriptor, 'operations'> {
  const operation = {
    id: operationId('content.resolve-dependencies', { contributionId: 'test/content' }),
    handlerId: 'resolve-dependencies',
    mutatesSource: false,
  } as const
  return {
    operations: [
      state === 'available'
        ? { ...operation, state: 'available' }
        : { ...operation, state: 'disabled', reason: 'initialization data unavailable' },
    ],
  }
}

function operations(value: unknown): OperationSession & { invoke: ReturnType<typeof vi.fn> } {
  return {
    invoke: vi.fn(async () => ({
      state: 'ok' as const,
      output: { kind: 'json' as const, value: value as never },
      diagnostics: [],
    })),
    async dispose() {},
  }
}

function sources(): ContentSources {
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
    async dispose() {},
  }
}

describe('operation content dependency coordinator', () => {
  it('reads the standard dependency operation as bounded inert data', async () => {
    const session = operations(dependencySet)
    await expect(
      readOperationContentDependencies({
        descriptor: descriptor(),
        operations: session,
      }),
    ).resolves.toMatchObject({ state: 'resolved', dependencies: dependencySet })
    expect(session.invoke).toHaveBeenCalledWith('resolve-dependencies', {}, undefined)
  })

  it('accepts the request carried beside a codec-owned workspace lock', async () => {
    await expect(
      readOperationContentDependencies({
        descriptor: descriptor(),
        operations: operations({
          schemaVersion: 1,
          loadOrder: [],
          contentDependencies: dependencySet,
        }),
      }),
    ).resolves.toMatchObject({ state: 'resolved', dependencies: dependencySet })
  })

  it('projects resolved closures into language sources and reports a failing operation', async () => {
    const failing: OperationSession = {
      invoke: async () => {
        throw new Error('handler exploded')
      },
      async dispose() {},
    }
    const resolveDependencies = vi.fn(async () => ({
      schemaVersion: 1 as const,
      gameId: 'example/game',
      complete: true,
      dependencies: [],
      diagnostics: [],
      mounts: [
        {
          dependencyId: 'base',
          order: 0,
          sourceId: 'local',
          sourcePath: 'Base',
          displayName: 'Base',
          kind: 'mod',
        },
      ],
    }))
    const projected = await resolveContentLanguageSources({
      contentSources: { ...sources(), resolveDependencies } as ContentSources,
      routes: [],
      limits: { maxDocumentBytes: 1024, maxWorkspaceBytes: 4096, maxEntries: 16 },
      subjects: [
        { descriptor: descriptor(), operations: operations(dependencySet) },
        { descriptor: descriptor(), operations: failing },
      ],
    })
    expect(resolveDependencies).toHaveBeenCalledWith(dependencySet)
    expect(projected.sources).toHaveLength(1)
    expect(projected.dependenciesComplete).toBe(false)
    expect(projected.diagnostics).toMatchObject([
      {
        code: 'x3.host/content-dependency-operation-failed',
        message: 'handler exploded',
      },
    ])
  })

  it('reports disabled and malformed dependency operations without consulting a source', async () => {
    await expect(
      readOperationContentDependencies({
        descriptor: descriptor('disabled'),
        operations: operations(dependencySet),
      }),
    ).resolves.toMatchObject({
      state: 'unresolved',
      diagnostics: [
        {
          code: 'x3.host/content-dependency-operation-unavailable',
          message: 'initialization data unavailable',
        },
      ],
    })
    await expect(
      readOperationContentDependencies({
        descriptor: descriptor(),
        operations: operations({ schemaVersion: 2 }),
      }),
    ).resolves.toMatchObject({
      state: 'unresolved',
      diagnostics: [
        {
          code: 'x3.host/content-dependency-operation-invalid',
        },
      ],
    })
  })

  it('continues from the codec operation into the host content resolver', async () => {
    await expect(
      analyzeOperationContentDependencies({
        descriptor: descriptor(),
        operations: operations(dependencySet),
        contentSources: sources(),
        workspaceId: 'subject:example',
        services: {} as never,
        grant: {} as never,
        budgets: {} as never,
        locales: ['enUS'],
        queries: [],
        limits: {
          maxRequirements: 1,
          maxDocumentBytes: 1,
          maxTextBytes: 1,
          maxEntities: 1,
          maxDepth: 1,
          maxPageSize: 1,
        },
      }),
    ).resolves.toMatchObject({
      state: 'unresolved',
      diagnostics: [
        {
          code: 'x3.host/content-dependency-resolver-unavailable',
        },
      ],
    })
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
      return {
        schemaVersion: 1,
        gameId: 'example/game',
        contextId: 'context',
        layers: [
          { id: 'l0', displayName: 'Core', sourceId: 'casc', sourcePath: 'Mods/Core', role: 'dependency', provenance: 'implicit' },
          { id: 'l1', displayName: 'Base', sourceId: 'casc', sourcePath: 'Mods/Base', role: 'base', provenance: 'setting' },
          { id: 'l2', displayName: 'script', sourceId: 'host', sourcePath: request.target, role: 'primary', provenance: 'opened' },
        ],
        unresolved: [],
        diagnostics: [],
        files: async () => ({ items: [] }),
        read: async () => new Uint8Array(),
        locate: async () => undefined,
        dispose,
      }
    })
    const resolveDependencies = vi.fn()
    const languageMounts = vi.fn(async () => ({
      schemaVersion: 1 as const,
      gameId: 'example/game',
      complete: true,
      dependencies: [],
      diagnostics: [],
      mounts: [
        { dependencyId: 'core', order: 0, sourceId: 'casc', sourcePath: 'mods/core', displayName: 'Core', kind: 'mod' },
        { dependencyId: 'wizards', order: 1, sourceId: 'wizards', sourcePath: '', displayName: 'Wizards', kind: 'editor-wizards' },
      ],
    }))
    const operationsSession = operations(dependencySet)
    const origins = await resolveContentAssetOrigins({
      contentSources: { ...sources(), openModContext, resolveDependencies, languageMounts } as ContentSources,
      subjects: [
        {
          descriptor: { ...descriptor(), subjectUri: 'file:///C:/Work/Scripts/My%20Script.galaxy' },
          operations: operationsSession,
        },
      ],
      baseMods: { '*': ['Mods/Void'], 'C:\\Work\\Scripts': ['Mods/Base'], 'C:/Work/Scripts2': ['Mods/Other'] },
      standingMounts: true,
    })
    expect(opened).toEqual([
      { schemaVersion: 1, target: 'C:/Work/Scripts/My Script.galaxy', baseMods: ['Mods/Base'] },
    ])
    expect(dispose).toHaveBeenCalledOnce()
    // the codec operation and the old resolver are not consulted for a subject on disk
    expect(operationsSession.invoke).not.toHaveBeenCalled()
    expect(resolveDependencies).not.toHaveBeenCalled()
    // the context's two content-source layers, then the standing wizards (Core is already held)
    expect(origins.origins).toHaveLength(2)
    expect(origins.dependenciesComplete).toBe(true)
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
