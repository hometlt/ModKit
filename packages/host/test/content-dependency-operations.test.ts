import { describe, expect, it, vi } from 'vitest'
import { operationId } from '@modkit/core'
import type { AnyDescriptor, OperationSession } from '@modkit/sdk'
import type { ContentSources } from '@modkit/vfs/content-sources'
import {
  analyzeOperationContentDependencies,
  readOperationContentDependencies,
  resolveContentLanguageSources,
} from '../src/content-dependency-operations.js'

const dependencySet = Object.freeze({
  schemaVersion: 1 as const,
  gameId: 'example/game',
  complete: true,
  dependencies: Object.freeze([{ id: 'base' }]),
})

function descriptor(state: 'available' | 'disabled' = 'available'): Pick<AnyDescriptor, 'operations'> {
  const operation = {
    id: operationId('content.resolve-dependencies', { contributionId: 'test/content' }),
    handlerId: 'resolve-dependencies',
    mutatesSource: false,
  } as const
  return {
    operations: [state === 'available'
      ? { ...operation, state: 'available' }
      : { ...operation, state: 'disabled', reason: 'initialization data unavailable' }],
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
    async snapshot() { return { label: 'test', regions: [], connections: [], roots: [] } },
    async connect() {}, async disconnect() {}, async search() { return [] }, async add() {},
    async remove() {}, async refresh() {}, async list() { return [] },
    async read() { return new Uint8Array() }, async dispose() {},
  }
}

describe('operation content dependency coordinator', () => {
  it('reads the standard dependency operation as bounded inert data', async () => {
    const session = operations(dependencySet)
    await expect(readOperationContentDependencies({
      descriptor: descriptor(), operations: session,
    })).resolves.toMatchObject({ state: 'resolved', dependencies: dependencySet })
    expect(session.invoke).toHaveBeenCalledWith('resolve-dependencies', {}, undefined)
  })

  it('accepts the request carried beside a codec-owned workspace lock', async () => {
    await expect(readOperationContentDependencies({
      descriptor: descriptor(),
      operations: operations({ schemaVersion: 1, loadOrder: [], contentDependencies: dependencySet }),
    })).resolves.toMatchObject({ state: 'resolved', dependencies: dependencySet })
  })

  it('projects resolved closures into language sources and reports a failing operation', async () => {
    const failing: OperationSession = {
      invoke: async () => { throw new Error('handler exploded') },
      async dispose() {},
    }
    const resolveDependencies = vi.fn(async () => ({
      schemaVersion: 1 as const, gameId: 'example/game', complete: true, dependencies: [],
      diagnostics: [],
      mounts: [{ dependencyId: 'base', order: 0, sourceId: 'local', sourcePath: 'Base', displayName: 'Base', kind: 'mod' }],
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
    expect(projected.diagnostics).toMatchObject([{
      code: 'x3.host/content-dependency-operation-failed',
      message: 'handler exploded',
    }])
  })

  it('reports disabled and malformed dependency operations without consulting a source', async () => {
    await expect(readOperationContentDependencies({
      descriptor: descriptor('disabled'), operations: operations(dependencySet),
    })).resolves.toMatchObject({ state: 'unresolved', diagnostics: [{
      code: 'x3.host/content-dependency-operation-unavailable',
      message: 'initialization data unavailable',
    }] })
    await expect(readOperationContentDependencies({
      descriptor: descriptor(), operations: operations({ schemaVersion: 2 }),
    })).resolves.toMatchObject({ state: 'unresolved', diagnostics: [{
      code: 'x3.host/content-dependency-operation-invalid',
    }] })
  })

  it('continues from the codec operation into the host content resolver', async () => {
    await expect(analyzeOperationContentDependencies({
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
        maxRequirements: 1, maxDocumentBytes: 1, maxTextBytes: 1,
        maxEntities: 1, maxDepth: 1, maxPageSize: 1,
      },
    })).resolves.toMatchObject({ state: 'unresolved', diagnostics: [{
      code: 'x3.host/content-dependency-resolver-unavailable',
    }] })
  })
})
