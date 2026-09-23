import { resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createHostMcpPort,
  createModkitMcpServer,
  type McpEnvelope,
  type ModkitMcpHostPort,
} from '../src/index.js'

let host: ModkitMcpHostPort
let app: ReturnType<typeof createModkitMcpServer>
let client: Client
const uri = 'untitled:Audit.fixturelang'
const body = (value: Awaited<ReturnType<Client['callTool']>>) =>
  value.structuredContent as McpEnvelope

beforeAll(async () => {
  const extension = resolve(import.meta.dirname, 'fixtures/language-session-extension')
  host = await createHostMcpPort({ roots: [extension], extensions: [extension], allowEdits: true })
  app = createModkitMcpServer(host)
  client = new Client({ name: 'adapter-audit', version: '1.0.0' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await Promise.all([app.server.connect(right), client.connect(left)])
}, 30_000)

afterAll(async () => {
  await client?.close()
  await app?.dispose()
  await host?.close()
})

describe('MCP adapter parity regressions', () => {
  it('reports unresolved language activation with an actionable error code', async () => {
    const result = await client.callTool({ name: 'modkit.language_session_open', arguments: {
      documents: [{ uri: 'untitled:Audit.unknown', languageId: 'unknown-language', text: 'source' }],
    } })
    expect(result.isError).toBe(true)
    expect(body(result).diagnostics[0]?.code).toBe('x3.mcp/language-provider-unresolved')
  })

  it('accepts every advertised language feature and refuses unsupported methods explicitly', async () => {
    const opened = body(
      await client.callTool({
        name: 'modkit.language_session_open',
        arguments: {
          documents: [{ uri, languageId: 'fixture-language', text: 'source', version: 1 }],
        },
      }),
    )
    const { sessionHandle, documents } = opened.data as {
      sessionHandle: string
      documents: { features: string[] }[]
    }
    try {
      const tools = await client.listTools()
      const featureTool = tools.tools.find(
        tool => tool.name === 'modkit.language_session_feature',
      )
      if (featureTool === undefined) throw new Error('language session feature tool is missing')
      const properties = featureTool.inputSchema.properties
      if (properties === undefined) throw new Error('language session feature schema is missing')
      const features = (properties.feature as { enum: string[] }).enum
      const document = documents[0]
      if (document === undefined) throw new Error('opened language document is missing')
      expect(features).toEqual(expect.arrayContaining(document.features))
      const tokens = await client.callTool({
        name: 'modkit.language_session_feature',
        arguments: {
          sessionHandle,
          primaryUri: uri,
          feature: 'semantic-tokens',
          maxResults: 1,
        },
      })
      expect(tokens.isError).not.toBe(true)
      expect((body(tokens).data as { result: unknown }).result).toMatchObject({
        tokens: [{ kind: 'keyword' }],
      })
      const unsupported = await client.callTool({
        name: 'modkit.language_session_feature',
        arguments: {
          sessionHandle,
          primaryUri: uri,
          feature: 'completion',
          position: { line: 0, character: 1 },
        },
      })
      expect(unsupported.isError).toBe(true)
      expect(body(unsupported).diagnostics[0]?.code).toBe('x3.mcp/language-feature-unsupported')
      const stale = await client.callTool({
        name: 'modkit.language_session_update',
        arguments: {
          sessionHandle,
          uri,
          version: 1,
          text: 'stale',
        },
      })
      expect(stale.isError).toBe(true)
      expect(body(stale).diagnostics[0]?.code).toBe('x3.mcp/language-version-stale')
    } finally {
      await client.callTool({ name: 'modkit.language_session_close', arguments: { sessionHandle } })
    }
  })

  it('sets isError for returned invalid envelopes as well as thrown errors', async () => {
    const result = await client.callTool({
      name: 'modkit.close_subject',
      arguments: { handle: 'unknown' },
    })
    expect(body(result).completeness).toBe('invalid')
    expect(result.isError).toBe(true)
  })

  it('discovers the retained language and resolved edit workflows in capabilities', async () => {
    const capabilities = body(await client.callTool({ name: 'modkit.capabilities', arguments: {} }))
    expect((capabilities.data as { operations: string[] }).operations).toEqual(
      expect.arrayContaining([
        'open-selection',
        'language-session-open',
        'language-session-update',
        'language-session-feature',
        'language-session-close',
        'open-resolved-workspace',
        'propose-resolved-edit',
        'subject-edit-target',
        'subject-isolation',
        'subject-isolation-plan',
        'release-output',
      ]),
    )
  })

  it('preserves feature incompleteness even when the dependency session is complete', async () => {
    const runtime = createModkitMcpServer({
      ...host,
      openLanguageSession: async () => ({
        documents: [],
        workspaceIncomplete: false,
        diagnostics: [],
        update: async () => {
          throw new Error('unused')
        },
        invoke: async request => ({
          snapshotId: 'partial-feature',
          diagnostics: [],
          primaryUri: uri,
          feature: request.feature,
          result: { locations: [], isIncomplete: true },
        }),
        close: () => Promise.resolve(),
      }),
    })
    const other = new Client({ name: 'bounded-feature', version: '1.0.0' })
    const [left, right] = InMemoryTransport.createLinkedPair()
    await Promise.all([runtime.server.connect(right), other.connect(left)])
    try {
      const opened = body(
        await other.callTool({
          name: 'modkit.language_session_open',
          arguments: {
            documents: [{ uri, languageId: 'fixture-language', text: 'source' }],
          },
        }),
      )
      const result = body(
        await other.callTool({
          name: 'modkit.language_session_feature',
          arguments: {
            sessionHandle: (opened.data as { sessionHandle: string }).sessionHandle,
            primaryUri: uri,
            feature: 'definition',
            position: { line: 0, character: 0 },
          },
        }),
      )
      expect(result.completeness).toBe('partial')
    } finally {
      await other.close()
      await runtime.dispose()
    }
  })
})
