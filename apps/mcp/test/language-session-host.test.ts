import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ContentSources } from '@modkit/vfs/content-sources'
import {
  createHostMcpPort,
  type McpLanguageSessionContext,
  type ModkitMcpHostPort,
} from '../src/index.js'

let root: string
let host: ModkitMcpHostPort
const dependencyBytes = new TextEncoder().encode('dependency')

const contentSources: ContentSources = {
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
  async list(_sourceId, path) {
    return path === 'root'
      ? [{ path: 'root/Dependency.fixturelang', name: 'Dependency.fixturelang', directory: false }]
      : []
  },
  async read(_sourceId, path, maximum) {
    if (path !== 'root/Dependency.fixturelang' || dependencyBytes.byteLength > maximum) {
      throw new RangeError('dependency unavailable')
    }
    return dependencyBytes.slice()
  },
  async resolveDependencies(request) {
    return {
      schemaVersion: 1,
      gameId: request.gameId,
      complete: true,
      mounts: [
        {
          dependencyId: 'fixture',
          order: 0,
          sourceId: 'fixture-source',
          sourcePath: 'root',
          displayName: 'Fixture dependency',
          kind: 'content-archive',
          fingerprint: 'content-hash.sha256:fixture',
        },
      ],
      dependencies: request.dependencies,
      diagnostics: [],
    }
  },
  async dispose() {},
}

const dependencyContext: McpLanguageSessionContext = {
  descriptor: {
    operations: [
      {
        id: 'content.resolve-dependencies',
        handlerId: 'resolve-dependencies',
        mutatesSource: false,
        state: 'available',
      },
    ],
  } as never,
  operations: {
    async invoke() {
      return {
        state: 'ok',
        output: {
          kind: 'json',
          value: {
            schemaVersion: 1,
            gameId: 'fixture/game',
            complete: true,
            dependencies: [{ id: 'fixture' }],
          },
        },
        diagnostics: [],
      }
    },
    async dispose() {},
  } as never,
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'modkit-mcp-language-session-'))
  host = await createHostMcpPort(
    {
      roots: [root],
      extensions: [resolve(import.meta.dirname, 'fixtures', 'language-session-extension')],
    },
    undefined,
    { contentSources },
  )
}, 30_000)

afterAll(async () => {
  await host?.close()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
}, 30_000)

describe('host-held MCP language session', () => {
  it('retains virtual source overlays with exact revisions and releases the provider', async () => {
    const uri = 'modkit-source://fixture/Scripts/Main.fixturelang'
    const session = await host.openLanguageSession!({
      documents: [
        {
          uri,
          languageId: 'fixture-language',
          documentKind: 'fixture-source',
          version: 7,
          text: 'initial',
        },
      ],
    })
    expect(session.documents).toEqual([
      {
        uri,
        languageId: 'fixture-language',
        documentKind: 'fixture-source',
        version: 7,
      },
    ])
    const hover = await session.invoke({
      primaryUri: uri,
      feature: 'hover',
      position: { line: 0, character: 1 },
      maxResults: 20,
      maxEdits: 20,
    })
    expect(hover.result).toMatchObject({ markdown: 'version 7: initial' })

    const changed = await session.update({ uri, version: 8, text: 'invalid' })
    expect(changed.snapshotId).toMatch(/^language-session-v1:/u)
    expect(session.documents).toEqual([
      {
        uri,
        languageId: 'fixture-language',
        documentKind: 'fixture-source',
        version: 8,
      },
    ])
    const diagnostics = await session.invoke({
      primaryUri: uri,
      feature: 'diagnostics',
      maxResults: 20,
      maxEdits: 20,
    })
    expect(diagnostics.result).toMatchObject({
      diagnostics: [{ code: 'fixture/invalid' }],
      isIncomplete: true,
    })
    const symbols = await session.invoke({
      primaryUri: uri,
      feature: 'document-symbols',
      maxResults: 20,
      maxEdits: 20,
    })
    expect(symbols.result).toMatchObject({
      symbols: [{ name: 'fixture', kind: 'function' }],
      isIncomplete: true,
    })
    await Promise.all([
      session.update({ uri, version: 9, text: 'queued-nine' }),
      session.update({ uri, version: 10, text: 'queued-ten' }),
    ])
    expect(session.documents[0]?.version).toBe(10)
    const latest = await session.invoke({
      primaryUri: uri,
      feature: 'hover',
      position: { line: 0, character: 1 },
      maxResults: 20,
      maxEdits: 20,
    })
    expect(latest.result).toMatchObject({ markdown: 'version 10: queued-ten' })
    await expect(session.update({ uri, version: 10, text: 'stale' })).rejects.toThrow(
      /strictly increase/u,
    )
    await session.close()
    await expect(
      session.invoke({
        primaryUri: uri,
        feature: 'diagnostics',
        maxResults: 20,
        maxEdits: 20,
      }),
    ).rejects.toThrow(/closed/u)
  })

  it('refuses unowned network URIs before language activation', async () => {
    await expect(
      host.openLanguageSession!({
        documents: [
          {
            uri: 'https://example.invalid/source.fixturelang',
            languageId: 'fixture-language',
            text: 'source',
          },
        ],
      }),
    ).rejects.toThrow(/unsupported scheme/u)
  })

  it('does not retain a session when no language provider resolves', async () => {
    await expect(
      host.openLanguageSession!({
        documents: [
          {
            uri: 'modkit-source://fixture/Scripts/Main.unknown',
            languageId: 'unknown-language',
            documentKind: 'unknown-source',
            version: 1,
            text: 'source',
          },
        ],
      }),
    ).rejects.toThrow(/language provider unresolved/u)
  })

  it('projects a subject dependency closure into the retained language workspace', async () => {
    const uri = 'modkit-source://fixture/Scripts/Main.fixturelang'
    const session = await host.openLanguageSession!(
      {
        documents: [
          {
            uri,
            languageId: 'fixture-language',
            documentKind: 'fixture-source',
            version: 1,
            text: 'source',
          },
        ],
      },
      undefined,
      dependencyContext,
    )
    try {
      expect(session.workspaceIncomplete).toBe(true)
      const definition = await session.invoke({
        primaryUri: uri,
        feature: 'definition',
        position: { line: 0, character: 1 },
        maxResults: 20,
        maxEdits: 20,
      })
      expect(definition.result).toMatchObject({
        // The closure is complete, but dependency documents are read-only for workspace edits.
        isIncomplete: true,
        locations: [{ uri: expect.stringMatching(/^content-source:\/\/fixture-source\//u) }],
      })
      expect(session.workspaceIncomplete).toBe(false)
    } finally {
      await session.close()
    }
  })
})
