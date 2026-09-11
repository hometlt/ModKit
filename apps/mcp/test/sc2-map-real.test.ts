import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHostMcpPort, createModkitMcpServer, type McpEnvelope, type ModkitMcpHostPort } from '../src/index.js'

const coreRoot = resolve(import.meta.dirname, '..', '..', '..')
const blizzardRoot = resolve(coreRoot, '..', 'modkit-extensions-blizzard')
const mapPath = process.env.MODKIT_SC2_MCP_MAP ?? 'C:/Apps/StarCraft II/Maps/all-races-coop-maps/02-CradleOfDeath.SC2Map'
let host: ModkitMcpHostPort; let app: ReturnType<typeof createModkitMcpServer>; let client: Client
const envelope = (value: Awaited<ReturnType<Client['callTool']>>) => value.structuredContent as McpEnvelope
const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')

beforeAll(async () => {
  host = await createHostMcpPort({ roots: [resolve(mapPath, '..')], extensions: [resolve(blizzardRoot, 'mpq'), resolve(blizzardRoot, 'starcraft2')] })
  app = createModkitMcpServer(host); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); client = new Client({ name: 'sc2-map-real', version: '1.0.0' }); await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
}, 180_000)
afterAll(async () => { await Promise.allSettled([client?.close(), app?.dispose(), host?.close()]) })

describe('installed SC2 map through generic MCP', () => {
  it('inventories, opens and inspects the map codec', async () => {
    let cursor: string | undefined; let inventoried = false
    do { const inventory = envelope(await client.callTool({ name: 'modkit.inventory', arguments: { limit: 20, ...(cursor === undefined ? {} : { cursor }) } })); inventoried ||= JSON.stringify(inventory.data).includes('blizzard/sc2-map'); cursor = inventory.nextCursor } while (!inventoried && cursor !== undefined)
    expect(inventoried).toBe(true)
    const opened = envelope(await client.callTool({ name: 'modkit.open_subject', arguments: { path: mapPath } })); const openData = opened.data as any; let handle = openData.handle as string
    if (Array.isArray(openData.selectionCandidates) && openData.selectionCandidates.length > 0) { const candidate = openData.selectionCandidates.find((item: any) => item.codecId === 'blizzard/sc2-map') ?? openData.selectionCandidates[0]; const selected = envelope(await client.callTool({ name: 'modkit.open_selection', arguments: { handle, selectionId: candidate.candidateId } })); handle = (selected.data as any).handle }
    if (typeof handle !== 'string') throw new Error(`SC2 map did not open: ${JSON.stringify(opened)}`)
    const inspected = envelope(await client.callTool({ name: 'modkit.inspect', arguments: { handle } })); const descriptor = (inspected.data as any).descriptor; const codecId = descriptor.identity.codecId as string; const worldOperation = `${codecId}.world`; expect(JSON.stringify(inspected.data)).toContain(worldOperation)
    const world = envelope(await client.callTool({ name: 'modkit.invoke_readonly', arguments: { handle, operationId: worldOperation, input: {} } })); expect(['complete', 'capped']).toContain(world.completeness); expect(JSON.stringify(world.data)).toContain('dimensions')
    const rendered = envelope(await client.callTool({ name: 'modkit.invoke_readonly', arguments: { handle, operationId: 'view.render', input: { layer: 'height' } } })); expect(rendered.completeness).not.toBe('invalid'); expect(rendered.data).toMatchObject({ result: { output: { kind: 'bytes', value: { kind: 'bytes' } } } })
    const preview = await client.readResource({ uri: `modkit://subject/${handle}/preview` }); const previewText = JSON.stringify(preview.contents); expect(previewText).toContain('SC2 map preview'); expect(previewText).not.toContain('subject-preview-unavailable')
    const facts = await client.callTool({ name: 'modkit.subject_facts', arguments: { handle, view: 'summary' } }); if (facts.isError === true) throw new Error(`facts failed: ${JSON.stringify(facts)}`)
    const graph = await client.callTool({ name: 'modkit.relation_graph', arguments: { handle, view: 'summary' } }); if (graph.isError === true) throw new Error(`graph failed: ${JSON.stringify(graph)}`)
    const heightPath = resolve(mapPath, 't3HeightMap'); const before = await digest(heightPath)
    const proposal = envelope(await client.callTool({ name: 'modkit.propose_edit', arguments: { handle, operationId: `${codecId}.edit-world`, input: { expectedSourceRevision: String(descriptor.revision), edits: [{ kind: 'terrain.cell.set', x: 0, y: 0, heightBase: 999 }] } } })); if (proposal.completeness === 'invalid') throw new Error(`proposal failed: ${JSON.stringify(proposal)}`); expect(proposal.data).toMatchObject({ committed: false }); expect(await digest(heightPath)).toBe(before)
    await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
  }, 180_000)
})
