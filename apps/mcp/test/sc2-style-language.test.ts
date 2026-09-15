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

const sheetText = [
  '<StyleFile>',
  '<Constant name="ColorTitle" val="807de5e9"/>',
  '<Style name="Title" textcolor="#ColorTitle"/>',
  '</StyleFile>',
  '',
].join('\n')
const catalogText = 'Unit/Name/Marine=<s val="Title">Marine</s> <s val="Title">!</s>\n'
const layoutText = '<Desc>\n<Frame type="Label" name="L">\n<Style val="@@Title"/>\n</Frame>\n</Desc>\n'
const coreRoot = resolve(import.meta.dirname, '..', '..', '..')
const blizzard = resolve(coreRoot, '..', 'modkit-extensions-blizzard', 'starcraft2')
let root: string
let sheetPath: string
let catalogPath: string
let layoutPath: string
let host: ModkitMcpHostPort
let app: ReturnType<typeof createModkitMcpServer>
let client: Client

const envelope = (value: Awaited<ReturnType<Client['callTool']>>) =>
  value.structuredContent as McpEnvelope

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'modkit-mcp-sc2-style-'))
  sheetPath = join(root, 'FontStyles.SC2Style')
  catalogPath = join(root, 'GameStrings.txt')
  layoutPath = join(root, 'Title.SC2Layout')
  await Promise.all([
    writeFile(sheetPath, sheetText, 'utf8'),
    writeFile(catalogPath, catalogText, 'utf8'),
    writeFile(layoutPath, layoutText, 'utf8'),
  ])
  host = await createHostMcpPort({ roots: [root], extensions: [blizzard] })
  app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'sc2-style-language', version: '1.0.0' })
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
}, 180_000)

afterAll(async () => {
  await Promise.allSettled([client?.close(), app?.dispose(), host?.close()])
  if (root !== undefined) await rm(root, { recursive: true, force: true })
}, 30_000)

describe('installed SC2 Style language through MCP', () => {
  it('activates the Style surfaces and follows a style into open SC2 Strings and SC2Layout documents', async () => {
    const sheetUri = pathToFileURL(sheetPath).href
    const catalogUri = pathToFileURL(catalogPath).href
    const layoutUri = pathToFileURL(layoutPath).href
    const opened = envelope(
      await client.callTool({
        name: 'modkit.language_session_open',
        arguments: {
          documents: [
            { path: sheetPath, languageId: 'sc2-style', documentKind: 'sc2-style-source', version: 2 },
            {
              path: catalogPath,
              languageId: 'sc2-strings',
              documentKind: 'sc2-strings-catalog',
              version: 3,
            },
            {
              path: layoutPath,
              languageId: 'sc2-layout',
              documentKind: 'sc2-layout-source',
              version: 4,
            },
          ],
        },
      }),
    )
    expect(opened.completeness, JSON.stringify(opened)).toBe('partial')
    expect(opened.data).toMatchObject({
      workspaceIncomplete: true,
      documents: [
        {
          uri: sheetUri,
          version: 2,
          features: expect.arrayContaining([
            'semantic-tokens',
            'definition',
            'references',
            'prepare-rename',
            'rename',
            'document-colors',
            'color-presentations',
            'workspace-symbols',
            'formatting',
            'code-actions',
          ]),
        },
        { uri: catalogUri },
        { uri: layoutUri },
      ],
    })
    const sessionHandle = (opened.data as { sessionHandle: string }).sessionHandle
    const feature = async (argumentsValue: Record<string, unknown>) =>
      envelope(
        await client.callTool({
          name: 'modkit.language_session_feature',
          arguments: { sessionHandle, primaryUri: sheetUri, ...argumentsValue },
        }),
      )
    try {
      const titleLine = 2
      const position = { line: titleLine, character: '<Style name="'.length + 1 }
      const references = await feature({
        feature: 'references',
        position,
        includeDeclaration: false,
      })
      // Both catalog uses as exact spans, then the layout use past its @@; the session stays incomplete.
      expect(references.data, JSON.stringify(references)).toMatchObject({
        result: {
          locations: [
            {
              uri: catalogUri,
              range: {
                start: { line: 0, character: catalogText.indexOf('Title') },
                end: { line: 0, character: catalogText.indexOf('Title') + 5 },
              },
            },
            {
              uri: catalogUri,
              range: { start: { line: 0, character: catalogText.lastIndexOf('Title') } },
            },
            {
              uri: layoutUri,
              range: {
                start: { line: 2, character: '<Style val="@@'.length },
                end: { line: 2, character: '<Style val="@@Title'.length },
              },
            },
          ],
          isIncomplete: true,
        },
      })

      // The catalog end: the Strings provider resolves `<s val="Title">` to the sheet declaration.
      const fromCatalog = await feature({
        primaryUri: catalogUri,
        feature: 'definition',
        position: { line: 0, character: catalogText.indexOf('Title') + 1 },
      })
      expect(fromCatalog.data, JSON.stringify(fromCatalog)).toMatchObject({
        result: {
          locations: [
            {
              uri: sheetUri,
              range: { start: { line: 2, character: '<Style name="'.length } },
            },
          ],
        },
      })

      const renamed = await feature({ feature: 'rename', position, newName: 'Heading', maxEdits: 8 })
      expect(renamed.data, JSON.stringify(renamed)).toMatchObject({
        result: {
          isComplete: true,
          documentChanges: [{ uri: sheetUri, documentVersion: 2, edits: [{ newText: 'Heading' }] }],
        },
      })
      expect(
        (renamed.data as { result: { documentChanges: unknown[] } }).result.documentChanges,
      ).toHaveLength(1)

      const colors = await feature({ feature: 'document-colors' })
      expect(colors.data, JSON.stringify(colors)).toMatchObject({
        result: {
          colors: [
            {
              range: { start: { line: 1, character: '<Constant name="ColorTitle" val="'.length } },
              color: { alpha: 0x80 / 255 },
            },
          ],
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
