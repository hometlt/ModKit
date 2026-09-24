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
/** Every target the loader was asked to open, in order. */
const opened: unknown[] = []

const contentSources: ContentSources = {
  async snapshot() {
    return { label: 'test', regions: [], connections: [], roots: [] }
  },
  connect: () => Promise.resolve(),
  disconnect: () => Promise.resolve(),
  async search() {
    return []
  },
  add: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  refresh: () => Promise.resolve(),
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
  // The subject opens inside one read-only layer of the fixture source.
  async openModContext(request) {
    opened.push(request.target)
    return {
      schemaVersion: 1,
      gameId: 'fixture/game',
      contextId: 'fixture',
      layers: [
        { id: 'dependency', displayName: 'Fixture dependency', sourceId: 'fixture-source', sourcePath: 'root', role: 'dependency', provenance: 'declared', fingerprint: 'content-hash.sha256:fixture' },
        { id: 'subject', displayName: 'subject', sourceId: 'fixture-source', sourcePath: String(typeof request.target === 'string' ? request.target : request.target.path), role: 'primary', provenance: 'opened' },
      ],
      unresolved: [],
      diagnostics: [],
      files: async () => ({ items: [] }),
      read: async () => new Uint8Array(),
      locate: async () => undefined,
      dispose: async () => {},
    }
  },
  dispose: () => Promise.resolve(),
}

const dependencyContext: McpLanguageSessionContext = {
  descriptor: {
    subjectUri: 'content-source://fixture-source/Scripts/Main.fixturelang',
    revision: 1,
    operations: [],
  } as never,
  operations: {
    invoke: () => Promise.reject(new Error('the loader, not an operation, names dependencies')),
    dispose: () => Promise.resolve(),
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
  const openLanguageSession = (
    target: ModkitMcpHostPort,
    ...input: Parameters<NonNullable<ModkitMcpHostPort['openLanguageSession']>>
  ) => {
    const open = target.openLanguageSession
    if (open === undefined) throw new Error('host did not expose language sessions')
    return open.apply(target, input)
  }

  it('retains virtual source overlays with exact revisions and releases the provider', async () => {
    const uri = 'modkit-source://fixture/Scripts/Main.fixturelang'
    const session = await openLanguageSession(host, {
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
        features: [
          'analyze',
          'semantic-tokens',
          'document-symbols',
          'diagnostics',
          'hover',
          'definition',
        ],
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
        features: [
          'analyze',
          'semantic-tokens',
          'document-symbols',
          'diagnostics',
          'hover',
          'definition',
        ],
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
      openLanguageSession(host, {
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
      openLanguageSession(host, {
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

  it('keeps selected locales in the published semantic context identity', async () => {
    const uri = 'modkit-source://fixture/Scripts/Locale.fixturelang'
    const open = (locales: readonly string[]) =>
      openLanguageSession(host, {
        locales,
        documents: [
          {
            uri,
            languageId: 'fixture-language',
            documentKind: 'fixture-source',
            version: 1,
            text: 'source',
          },
        ],
      })
    const en = await open(['enUS'])
    const de = await open(['deDE', 'enUS'])
    try {
      const request = {
        primaryUri: uri,
        feature: 'hover' as const,
        position: { line: 0, character: 1 },
        maxResults: 20,
        maxEdits: 20,
      }
      const [enResult, deResult] = await Promise.all([en.invoke(request), de.invoke(request)])
      expect(enResult.workspaceContext).toMatchObject({
        id: expect.stringMatching(/^language-context-v1:/u),
        revision: expect.stringMatching(/^language-context-v1:/u),
      })
      expect(deResult.workspaceContext?.id).not.toBe(enResult.workspaceContext?.id)
    } finally {
      await Promise.all([en.close(), de.close()])
    }
    await expect(open(['enUS', 'enUS'])).rejects.toThrow(/unique bounded identifiers/u)
  })

  it('projects a subject dependency closure into the retained language workspace', async () => {
    const uri = 'modkit-source://fixture/Scripts/Main.fixturelang'
    const session = await openLanguageSession(
      host,
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
        // The closure is complete; its dependency documents are read-only, which refuses an edit
        // reaching them but does not make a lookup incomplete.
        isIncomplete: false,
        locations: [{ uri: expect.stringMatching(/^content-source:\/\/fixture-source\//u) }],
      })
      expect(definition.workspaceContext).toMatchObject({ semanticComplete: true })
      expect(session.workspaceIncomplete).toBe(false)
    } finally {
      await session.close()
    }
  })

  it('reads a subject mod context: its layers in load order and what is missing', async () => {
    const read = host.modContext
    if (read === undefined) throw new Error('host did not expose mod contexts')
    const context = await read.call(host, 'content-source://fixture-source/Scripts/Main.fixturelang')
    expect(context.layers.map(layer => [layer.sourcePath, layer.role, layer.fingerprint])).toEqual([
      ['root', 'dependency', 'content-hash.sha256:fixture'],
      ['Scripts/Main.fixturelang', 'primary', undefined],
    ])
    expect(context.unresolved).toEqual([])
    await expect(read.call(host, 'untitled:Scratch')).rejects.toThrow('neither a file')
  })

  it('opens a virtual document as a file not yet saved into the first root', async () => {
    const uri = 'untitled:Scratch.fixturelang'
    const before = opened.length
    const session = await openLanguageSession(host, {
      documents: [{ uri, languageId: 'fixture-language', documentKind: 'fixture-source', version: 1, text: 'source' }],
    })
    try {
      // Roots are canonical (realpath), so only the saved-into name is fixed.
      expect(opened.slice(before)).toEqual([expect.stringMatching(/\/Scratch\.fixturelang$/u)])
    } finally {
      await session.close()
    }
  })
})
