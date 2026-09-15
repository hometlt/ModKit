import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createHostMcpPort,
  createModkitMcpServer,
  type McpEnvelope,
  type ModkitMcpHostPort,
} from '../src/index.js'

const text = '<?xml version="1.0"?><Bank><Section name="Stats"><Key name="Wins"/></Section></Bank>'
const coreRoot = resolve(import.meta.dirname, '..', '..', '..')
const blizzard = resolve(coreRoot, '..', 'modkit-extensions-blizzard', 'starcraft2')
let root: string
let path: string
let host: ModkitMcpHostPort
let app: ReturnType<typeof createModkitMcpServer>
let client: Client

const envelope = (value: Awaited<ReturnType<Client['callTool']>>) =>
  value.structuredContent as McpEnvelope

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'modkit-mcp-sc2-bank-'))
  path = join(root, 'Progress.SC2Bank')
  await writeFile(path, text, 'utf8')
  host = await createHostMcpPort({ roots: [root], extensions: [blizzard] })
  app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'sc2-bank-language', version: '1.0.0' })
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
}, 180_000)

afterAll(async () => {
  await Promise.allSettled([client?.close(), app?.dispose(), host?.close()])
  if (root !== undefined) await rm(root, { recursive: true, force: true })
}, 30_000)

describe('installed SC2 Bank language through MCP', () => {
  it('reports activated navigation and returns a revision-bound rename proposal', async () => {
    const uri = pathToFileURL(path).href
    const opened = envelope(
      await client.callTool({
        name: 'modkit.language_session_open',
        arguments: {
          documents: [
            { path, languageId: 'sc2-bank', documentKind: 'sc2-bank-source', version: 4 },
          ],
        },
      }),
    )
    expect(opened.completeness, JSON.stringify(opened)).toBe('partial')
    expect(opened.data).toMatchObject({
      workspaceIncomplete: true,
      documents: [
        {
          uri,
          version: 4,
          features: expect.arrayContaining([
            'definition',
            'references',
            'prepare-rename',
            'rename',
            'formatting',
            'code-actions',
          ]),
        },
      ],
    })
    const sessionHandle = (opened.data as { sessionHandle: string }).sessionHandle
    try {
      const position = { line: 0, character: text.indexOf('Wins') + 1 }
      const prepared = envelope(
        await client.callTool({
          name: 'modkit.language_session_feature',
          arguments: { sessionHandle, primaryUri: uri, feature: 'prepare-rename', position },
        }),
      )
      expect(prepared.data).toMatchObject({ result: { placeholder: 'Wins' } })
      const renamed = envelope(
        await client.callTool({
          name: 'modkit.language_session_feature',
          arguments: {
            sessionHandle,
            primaryUri: uri,
            feature: 'rename',
            position,
            newName: 'Victories',
            maxEdits: 8,
          },
        }),
      )
      expect(renamed.data).toMatchObject({
        result: {
          isComplete: true,
          documentChanges: [{ uri, documentVersion: 4, edits: [{ newText: 'Victories' }] }],
        },
      })
    } finally {
      await client.callTool({
        name: 'modkit.language_session_close',
        arguments: { sessionHandle },
      })
    }
  }, 180_000)
})
