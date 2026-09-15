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

const primaryText =
  '<wizardfile><wizard id="Main"><name>Main</name><input id="Value" type="WizardText"><default value="^Shared:Nested^"/></input></wizard></wizardfile>\n'
const sharedText =
  '<wizardfile><wizard id="Shared"><name>Shared</name><input id="Nested" type="WizardText"/></wizard></wizardfile>\n'
const coreRoot = resolve(import.meta.dirname, '..', '..', '..')
const blizzard = resolve(coreRoot, '..', 'modkit-extensions-blizzard', 'starcraft2')
let root: string
let primaryPath: string
let sharedPath: string
let host: ModkitMcpHostPort
let app: ReturnType<typeof createModkitMcpServer>
let client: Client

const envelope = (value: Awaited<ReturnType<Client['callTool']>>) =>
  value.structuredContent as McpEnvelope

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'modkit-mcp-sc2-wizard-'))
  primaryPath = join(root, 'Main.BlizWiz')
  sharedPath = join(root, 'Shared.BlizWiz')
  await Promise.all([
    writeFile(primaryPath, primaryText, 'utf8'),
    writeFile(sharedPath, sharedText, 'utf8'),
  ])
  host = await createHostMcpPort({ roots: [root], extensions: [blizzard] })
  app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'sc2-wizard-language', version: '1.0.0' })
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
}, 180_000)

afterAll(async () => {
  await Promise.allSettled([client?.close(), app?.dispose(), host?.close()])
  if (root !== undefined) await rm(root, { recursive: true, force: true })
}, 30_000)

describe('installed SC2 Wizard language through MCP', () => {
  it('activates the wizard surfaces and resolves a qualified token into another open wizard', async () => {
    const primaryUri = pathToFileURL(primaryPath).href
    const sharedUri = pathToFileURL(sharedPath).href
    const document = (path: string, version: number) => ({
      path,
      languageId: 'sc2-wizard',
      documentKind: 'sc2-wizard-source',
      version,
    })
    const opened = envelope(
      await client.callTool({
        name: 'modkit.language_session_open',
        arguments: { documents: [document(primaryPath, 2), document(sharedPath, 5)] },
      }),
    )
    expect(opened.completeness, JSON.stringify(opened)).toBe('partial')
    expect(opened.data).toMatchObject({
      workspaceIncomplete: true,
      documents: [
        {
          uri: primaryUri,
          version: 2,
          features: expect.arrayContaining([
            'semantic-tokens',
            'diagnostics',
            'document-symbols',
            'completion',
            'hover',
            'definition',
            'references',
            'prepare-rename',
            'rename',
            'workspace-symbols',
            'formatting',
            'code-actions',
          ]),
        },
        { uri: sharedUri },
      ],
    })
    const sessionHandle = (opened.data as { sessionHandle: string }).sessionHandle
    const feature = async (argumentsValue: Record<string, unknown>) =>
      envelope(
        await client.callTool({
          name: 'modkit.language_session_feature',
          arguments: { sessionHandle, primaryUri, ...argumentsValue },
        }),
      )
    try {
      const position = { line: 0, character: primaryText.indexOf('Shared:Nested') + 'Shared:'.length + 2 }
      const definition = await feature({ feature: 'definition', position })
      expect(definition.data, JSON.stringify(definition)).toMatchObject({
        result: { locations: [{ uri: sharedUri }], isIncomplete: true },
      })

      // The wizard provider refuses every rename in a snapshot it cannot prove complete.
      const renamed = await feature({ feature: 'rename', position, newName: 'SharedValue', maxEdits: 8 })
      expect(renamed.completeness, JSON.stringify(renamed)).not.toBe('invalid')
      expect((renamed.data as { result?: unknown } | null)?.result ?? null).toBeNull()
    } finally {
      await client.callTool({
        name: 'modkit.language_session_close',
        arguments: { sessionHandle },
      })
    }
  }, 180_000)
})
