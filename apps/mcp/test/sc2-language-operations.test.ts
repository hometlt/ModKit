import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createHostMcpPort,
  createModkitMcpServer,
  type McpEnvelope,
  type ModkitMcpHostPort,
} from '../src/index.js'

const coreRoot = resolve(import.meta.dirname, '..', '..', '..')
const blizzardRoot = resolve(coreRoot, '..', 'modkit-extensions-blizzard')
const triggerText = [
  '<TriggerData><Library Id="Test">',
  '<Element Type="ParamDef" Id="Amount"><Identifier>amount</Identifier><ParameterType><Type Value="int"/></ParameterType></Element>',
  '<Element Type="FunctionDef" Id="Do"><Identifier>DoThing</Identifier><Parameter Type="ParamDef" Library="Test" Id="Amount"/></Element>',
  '<Element Type="FunctionCall" Id="Call"><FunctionDef Type="FunctionDef" Library="Test" Id="Do"/><Parameter Type="Param" Id="One"/></Element>',
  '<Element Type="Param" Id="Unit"><Value>Marine</Value><ValueType Type="gamelink"/><ValueGameType Type="Unit"/></Element>',
  '</Library></TriggerData>',
].join('')

let scratch: string
let triggerPath: string
let galaxyPath: string
let dataPath: string
let layoutPath: string
let host: ModkitMcpHostPort
let app: ReturnType<typeof createModkitMcpServer>
let client: Client

const envelope = (value: Awaited<ReturnType<Client['callTool']>>) =>
  value.structuredContent as McpEnvelope

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'modkit-sc2-mcp-'))
  triggerPath = join(scratch, 'Fixture.Triggers')
  galaxyPath = join(scratch, 'MapScript.galaxy')
  dataPath = join(scratch, 'Test.SC2Mod', 'GameData', 'UnitData.xml')
  layoutPath = join(scratch, 'Test.SC2Mod', 'UI', 'Layout', 'Test.SC2Layout')
  await Promise.all([mkdir(join(dataPath, '..'), { recursive: true }), mkdir(join(layoutPath, '..'), { recursive: true })])
  await Promise.all([
    writeFile(triggerPath, triggerText, 'utf8'),
    writeFile(galaxyPath, 'void Init() { point p; UnitCreate(1, "Marine", 0, 1, p, 0.0); }', 'utf8'),
    writeFile(dataPath, '<?xml version="1.0"?><Catalog><CUnit id="Marine"><LifeMax value="45"/></CUnit></Catalog>', 'utf8'),
    writeFile(layoutPath, '<?xml version="1.0"?><Desc><Frame type="Button" name="Close"><Shortcut val="@Button/Hotkey/Cancel"/></Frame></Desc>', 'utf8'),
  ])
  host = await createHostMcpPort({
    roots: [scratch],
    extensions: [resolve(blizzardRoot, 'starcraft2')],
  })
  app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'sc2-language-operations', version: '1.0.0' })
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
}, 180_000)

afterAll(async () => {
  await Promise.allSettled([client?.close(), app?.dispose(), host?.close()])
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
})

async function openSubject(path: string, preferredCodecId: string): Promise<string> {
  const opened = envelope(
    await client.callTool({ name: 'modkit.open_subject', arguments: { path } }),
  )
  const data = opened.data as {
    readonly handle?: unknown
    readonly selectionCandidates?: readonly { readonly candidateId: string; readonly codecId?: string }[]
  }
  if ((data.selectionCandidates?.length ?? 0) === 0) {
    if (typeof data.handle === 'string') return data.handle
    throw new Error(`${path} did not open: ${JSON.stringify(opened)}`)
  }
  const candidate =
    data.selectionCandidates?.find(item => item.codecId === preferredCodecId) ??
    data.selectionCandidates?.[0]
  if (candidate === undefined || typeof data.handle !== 'string')
    throw new Error(`${path} did not expose an openable selection: ${JSON.stringify(opened)}`)
  const selected = envelope(await client.callTool({
    name: 'modkit.open_selection',
    arguments: { handle: data.handle, selectionId: candidate.candidateId },
  }))
  const handle = (selected.data as { readonly handle?: unknown }).handle
  if (typeof handle !== 'string') throw new Error(`${path} selection failed: ${JSON.stringify(selected)}`)
  return handle
}

describe('SC2 language and TriggerData operations through generic MCP', () => {
  it('routes Galaxy diagnostics and TriggerData signature help through document-analysis providers', async () => {
    const diagnostics = envelope(await client.callTool({
      name: 'modkit.language',
      arguments: {
        documents: [{ path: galaxyPath, languageId: 'galaxy', documentKind: 'galaxy-source' }],
        primaryIndex: 0,
        feature: 'diagnostics',
        maxResults: 64,
        maxEdits: 64,
      },
    }))
    expect(diagnostics.completeness).not.toBe('invalid')
    expect(JSON.stringify(diagnostics.data)).toContain('diagnostics')

    const character = triggerText.indexOf('Id="One"') + 4
    const signature = envelope(await client.callTool({
      name: 'modkit.language',
      arguments: {
        documents: [{ path: triggerPath, languageId: 'sc2-triggers', documentKind: 'sc2-triggers-source' }],
        primaryIndex: 0,
        feature: 'signature-help',
        position: { line: 0, character },
        maxResults: 64,
        maxEdits: 64,
      },
    }))
    expect(signature.completeness).not.toBe('invalid')
    expect(JSON.stringify(signature.data)).toContain('void DoThing(int amount)')
  }, 180_000)

  it('pages the native trigger tree and proposes a revision-pinned edit without writing', async () => {
    const before = await readFile(triggerPath, 'utf8')
    const handle = await openSubject(triggerPath, 'blizzard/sc2-triggers')
    try {
      const tree = envelope(await client.callTool({
        name: 'modkit.invoke_readonly',
        arguments: {
          handle,
          operationId: 'blizzard/sc2-triggers.tree-page',
          input: { limit: 2 },
        },
      }))
      expect(tree.completeness).not.toBe('invalid')
      expect(JSON.stringify(tree.data)).toContain('ParamDef')

      const proposal = envelope(await client.callTool({
        name: 'modkit.propose_edit',
        arguments: {
          handle,
          operationId: 'edit.content',
          input: { renames: [{ catalog: 'Unit', oldId: 'Marine', newId: 'Marauder' }] },
        },
      }))
      expect(proposal.completeness).not.toBe('invalid')
      expect(proposal.data).toMatchObject({ committed: false })
      expect(await readFile(triggerPath, 'utf8')).toBe(before)
    } finally {
      await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
    }
  }, 180_000)

  it('routes Data and Layout language plus native edit proposals without writing either file', async () => {
    for (const document of [
      { path: dataPath, languageId: 'sc2-data', documentKind: 'sc2-data-source' },
      { path: layoutPath, languageId: 'sc2-layout', documentKind: 'sc2-layout-source' },
    ]) {
      const result = envelope(await client.callTool({
        name: 'modkit.language',
        arguments: {
          documents: [document],
          primaryIndex: 0,
          feature: 'diagnostics',
          maxResults: 64,
          maxEdits: 64,
        },
      }))
      expect(result.completeness).not.toBe('invalid')
      expect(JSON.stringify(result.data)).toContain('diagnostics')

      const formatting = envelope(await client.callTool({
        name: 'modkit.language',
        arguments: {
          documents: [document],
          primaryIndex: 0,
          feature: 'formatting',
          formatting: { tabSize: 2, insertSpaces: true, finalNewline: true },
          maxResults: 64,
          maxEdits: 64,
        },
      }))
      expect(formatting.completeness).not.toBe('invalid')
      expect(JSON.stringify(formatting.data)).toContain('newText')
    }

    const cases = [
      {
        path: dataPath,
        codecId: 'blizzard/sc2-data',
        input: { renames: [{ namespace: 'Unit', oldId: 'Marine', newId: 'MarineElite' }] },
      },
      {
        path: layoutPath,
        codecId: 'blizzard/sc2-layout',
        input: { namespace: 'Button', oldId: 'Cancel', newId: 'Confirm' },
      },
    ] as const
    for (const item of cases) {
      const before = await readFile(item.path, 'utf8')
      const handle = await openSubject(item.path, item.codecId)
      try {
        const inspection = envelope(await client.callTool({
          name: 'modkit.invoke_readonly',
          arguments: { handle, operationId: 'view.inspect', input: {} },
        }))
        expect(inspection.completeness).not.toBe('invalid')
        const proposal = envelope(await client.callTool({
          name: 'modkit.propose_edit',
          arguments: { handle, operationId: 'edit.content', input: item.input },
        }))
        expect(proposal.completeness).not.toBe('invalid')
        expect(proposal.data).toMatchObject({ committed: false })
        expect(await readFile(item.path, 'utf8')).toBe(before)
      } finally {
        await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
      }
    }
  }, 180_000)
})
