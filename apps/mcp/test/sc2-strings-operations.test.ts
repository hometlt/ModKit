import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
const blizzard = resolve(coreRoot, '..', 'modkit-extensions-blizzard', 'starcraft2')
const catalogText = [
  'Unit/Name/Marine=Marine',
  'Unit/Name/Marauder=Marauder',
  'Unit/Name/Medic=Medic',
  'Unit/Name/Reaper=Reaper',
  '',
].join('\n')
let root: string
let catalogPath: string
let plainPath: string
let host: ModkitMcpHostPort
let app: ReturnType<typeof createModkitMcpServer>
let client: Client

const envelope = (value: Awaited<ReturnType<Client['callTool']>>) =>
  value.structuredContent as McpEnvelope

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'modkit-mcp-sc2-strings-'))
  catalogPath = join(root, 'Test.SC2Mod', 'enUS.SC2Data', 'LocalizedData', 'GameStrings.txt')
  plainPath = join(root, 'notes', 'settings.txt')
  await Promise.all([
    mkdir(join(catalogPath, '..'), { recursive: true }),
    mkdir(join(plainPath, '..'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(catalogPath, catalogText, 'utf8'),
    // Key/value text that is not an SC2 catalog: no catalog stem, no locale directory.
    writeFile(plainPath, 'volume=7\ntheme=dark\n', 'utf8'),
  ])
  host = await createHostMcpPort({ roots: [root], extensions: [blizzard] })
  app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'sc2-strings-operations', version: '1.0.0' })
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
}, 180_000)

afterAll(async () => {
  await Promise.allSettled([client?.close(), app?.dispose(), host?.close()])
  if (root !== undefined) await rm(root, { recursive: true, force: true })
}, 30_000)

type Opened = {
  readonly handle?: string
  readonly codecId?: string
  readonly selectionCandidates?: readonly { readonly candidateId: string; readonly codecId?: string }[]
}

async function open(path: string): Promise<{ envelope: McpEnvelope; data: Opened }> {
  const opened = envelope(await client.callTool({ name: 'modkit.open_subject', arguments: { path } }))
  return { envelope: opened, data: (opened.data ?? {}) as Opened }
}

/** Provenance entries are JSON; only objects carry a contribution id. */
const contributionOf = (item: unknown): string | undefined =>
  typeof item === 'object' && item !== null && !Array.isArray(item)
    ? ((item as Record<string, unknown>)['contributionId'] as string | undefined)
    : undefined

describe('installed SC2 Strings operations through MCP', () => {
  it('compares a locale against an SC2 catalog through the generic asset.compare operation', async () => {
    const opened = await open(catalogPath)
    let handle = opened.data.handle
    const strings = opened.data.selectionCandidates?.find(item => item.codecId === 'blizzard/sc2-strings')
    // A catalog path must offer the SC2 codec; silently using another handle would hide a routing loss.
    const offersStrings =
      opened.data.codecId === 'blizzard/sc2-strings' ||
      opened.envelope.provenance.some(item => contributionOf(item) === 'blizzard/sc2-strings') ||
      strings !== undefined
    expect(offersStrings, JSON.stringify(opened.envelope)).toBe(true)
    if (strings !== undefined && handle !== undefined) {
      const selected = envelope(
        await client.callTool({
          name: 'modkit.open_selection',
          arguments: { handle, selectionId: strings.candidateId },
        }),
      )
      handle = (selected.data as { handle?: string }).handle
    }
    expect(handle, JSON.stringify(opened.envelope)).toBeTypeOf('string')
    try {
      const compared = envelope(
        await client.callTool({
          name: 'modkit.invoke_readonly',
          arguments: {
            handle,
            operationId: 'asset.compare',
            input: {
              locale: 'deDE',
              entries: [
                { key: 'Unit/Name/Marine', value: 'Marineinfanterist' },
                { key: 'Unit/Name/Marauder', value: 'Marauder' },
                { key: 'Unit/Name/Medic', value: '' },
                { key: 'Unit/Name/Ghost', value: 'Geist' },
              ],
            },
          },
        }),
      )
      expect(compared.completeness, JSON.stringify(compared)).not.toBe('invalid')
      expect(JSON.stringify(compared.data)).toContain('"targetLocale":"deDE"')
      const result = JSON.parse(JSON.stringify(compared.data)) as Record<string, unknown>
      const value = (findComparison(result) ?? {}) as Record<string, unknown>
      expect(value).toMatchObject({
        missing: ['Unit/Name/Reaper'],
        orphaned: ['Unit/Name/Ghost'],
        identical: ['Unit/Name/Marauder'],
        empty: ['Unit/Name/Medic'],
        total: 4,
        translated: 1,
      })
    } finally {
      await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
    }
  }, 180_000)

  it('does not treat key/value text outside an SC2 catalog path as SC2 localization', async () => {
    const opened = await open(plainPath)
    const offered = [
      opened.data.codecId,
      ...(opened.data.selectionCandidates ?? []).map(item => item.codecId),
    ]
    expect(offered, JSON.stringify(opened.envelope)).not.toContain('blizzard/sc2-strings')
    // It still opens — as generic text, which is what it is.
    expect(opened.envelope.provenance.map(contributionOf)).toContain('modkit/txt')
    if (opened.data.handle !== undefined) {
      await client.callTool({ name: 'modkit.close_subject', arguments: { handle: opened.data.handle } })
    }
  }, 180_000)
})

/** The operation result is wrapped by the MCP envelope; find the object carrying the comparison. */
function findComparison(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return undefined
  if ('targetLocale' in value) return value
  for (const child of Object.values(value)) {
    const found = findComparison(child)
    if (found !== undefined) return found
  }
  return undefined
}
