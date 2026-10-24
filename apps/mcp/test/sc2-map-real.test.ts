import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { MapLayerDescriptor, MapLayerGrid } from '@modkit/sdk/maps'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHostMcpPort, createModkitMcpServer, type McpEnvelope, type ModkitMcpHostPort } from '../src/index.js'

const coreRoot = resolve(import.meta.dirname, '..', '..', '..')
// A committed snapshot (.acceptance) keeps the extension still while other sessions edit the live one.
const blizzardRoot = process.env.MODKIT_BLIZZARD_ROOT ?? resolve(coreRoot, '..', 'modkit-extensions-blizzard')
const mapPath = process.env.MODKIT_SC2_MCP_MAP ?? 'F:/GAMES/Blizzard/StarCraft II/Maps/all-races-coop-maps/02-CradleOfDeath.SC2Map'
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
    do { const inventory = envelope(await client.callTool({ name: 'modkit.inventory', arguments: { limit: 20, ...(cursor === undefined ? {} : { cursor }) } })); inventoried ||= JSON.stringify(inventory.data).includes('blizzard/sc2-map'); cursor = inventory.nextCursor ?? undefined } while (!inventoried && cursor !== undefined)
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

// A1 on SC2: the same MCP route as UVW and Warzone, on a copy of the installed folder map. The game
// extension is trusted as a shipped one, so its writer's own fidelity proof counts.
describe('installed SC2 map height through generic MCP', () => {
  let root: string
  let copy: string
  let writer: { host: ModkitMcpHostPort; app: ReturnType<typeof createModkitMcpServer>; client: Client }
  const call = async (name: string, args: Record<string, unknown>) => {
    // Opening the 25 MB folder map with the game's codecs took 107-127 s warm and over 170 s cold on
    // 25.10 (Blizzard snapshot 55826cdc): far past the client's 60 s default.
    const result = await writer.client.callTool({ name, arguments: args }, { timeout: 290_000 })
    if (result.isError === true) throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent ?? result.content)}`)
    return result
  }
  const value =(result: Awaited<ReturnType<Client['callTool']>>) =>
    ((envelope(result).data as { result: { output: { value: unknown } } }).result.output.value)
  const files = async () =>
    new Map(
      await Promise.all(
        (await readdir(copy)).filter(name => !name.endsWith('.SC2Data')).map(async name => [name, await digest(join(copy, name))] as const),
      ),
    )

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'modkit-mcp-sc2-map-'))
    copy = join(root, basename(mapPath))
    await cp(mapPath, copy, { recursive: true })
    // CASC opens the installation the map's world resolves its dependencies against.
    const host = await createHostMcpPort({
      roots: [root],
      extensions: [resolve(blizzardRoot, 'mpq'), resolve(blizzardRoot, 'casc'), resolve(blizzardRoot, 'starcraft2')],
      trustExtensions: true,
      allowEdits: true,
    })
    const app = createModkitMcpServer(host)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'sc2-map-height-real', version: '1.0.0' })
    await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
    writer = { host, app, client }
  }, 180_000)
  afterAll(async () => {
    await Promise.allSettled([writer?.client.close(), writer?.app.dispose()])
    await writer?.host.close()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }, 60_000)

  it('reads a height window, writes it, commits, reopens, refuses a stale plan and undoes', async () => {
    const open = async () => {
      const opened = envelope(await call('modkit.open_subject', { path: copy })).data as {
        handle: string
        selectionCandidates?: { candidateId: string; codecId?: string }[]
      }
      const candidate = opened.selectionCandidates?.find(item => item.codecId?.startsWith('blizzard/sc2-map') === true)
      return candidate === undefined
        ? opened.handle
        : ((envelope(await call('modkit.open_selection', { handle: opened.handle, selectionId: candidate.candidateId })).data as { handle: string }).handle)
    }
    const before = await files()
    const handle = await open()
    const layers = value(await call('modkit.invoke_readonly', { handle, operationId: 'map.layers', input: {} })) as { layers: MapLayerDescriptor[] }
    const layer = layers.layers.find(item => item.meaning === 'height')
    if (layer === undefined) throw new Error('the SC2 map lists no height layer')
    expect(layer).toMatchObject({ editable: true, sampling: 'vertex' })
    const window = { layer: layer.id, x: Math.floor(layer.width / 2), y: Math.floor(layer.height / 2), width: 4, height: 3 }
    const read = value(await call('modkit.invoke_readonly', { handle, operationId: 'map.layer-read', input: window })) as MapLayerGrid
    const drawn = await call('modkit.invoke_readonly', { handle, operationId: 'map.layer-read', input: { layer: layer.id }, render: 'image' })
    expect((drawn.content as { type: string }[]).some(item => item.type === 'image')).toBe(true)

    const values = read.values.map(sample => (sample === layer.maximum ? sample - 1 : sample + 1))
    const propose = async (input: unknown) => {
      const proposal = envelope(await call('modkit.propose_edit', { handle, operationId: 'map.layer-write', input }))
      const planHandle = (proposal.data as { planHandle?: string } | null)?.planHandle
      if (planHandle === undefined) throw new Error(`no plan: ${JSON.stringify(proposal)}`)
      return planHandle
    }
    const planHandle = await propose({ ...window, values })
    const olderPlan = await propose({ ...window, values: read.values.map(() => layer.minimum) })
    const prepared = envelope(await call('modkit.prepare_edit', { planHandle }))
    // Writing heights leaves the game's own height map as it was; the plan says so.
    expect(JSON.stringify(prepared)).toContain('blizzard/sc2-map-sync-height-not-updated')
    const committed = (envelope(await call('modkit.commit_edit', { planHandle })).data as {
      result: { state: string; receipt: { transactionId: string } }
    }).result
    expect(committed.state).toBe('committed')
    const after = await files()
    for (const [name, sum] of before) {
      if (name === 't3HeightMap') expect(after.get(name)).not.toBe(sum)
      else expect(after.get(name), name).toBe(sum)
    }

    const stale = await writer.client.callTool({ name: 'modkit.prepare_edit', arguments: { planHandle: olderPlan } })
    expect(envelope(stale).completeness).toBe('invalid')
    await writer.client.callTool({ name: 'modkit.discard_edit', arguments: { id: olderPlan } })
    const reopened = await open()
    const reread = value(await call('modkit.invoke_readonly', { handle: reopened, operationId: 'map.layer-read', input: window })) as MapLayerGrid
    expect(reread.values).toEqual(values)
    await call('modkit.close_subject', { handle: reopened })

    await call('modkit.undo_edit', { transactionId: committed.receipt.transactionId })
    expect(await files()).toEqual(before)
    await call('modkit.close_subject', { handle })
  }, 600_000)

  // The edit the world names must be one the installed map really publishes: a folder map once
  // named blizzard/sc2-map.edit-world while it publishes blizzard/sc2-map-directory.edit-world.
  it('moves an object through the edit its world names, commits, reopens and undoes', async () => {
    const world = async (on: string, query: Record<string, unknown>) => {
      const result = await writer.client.callTool({ name: 'modkit.world_scene', arguments: { handle: on, ...query } }, { timeout: 290_000 })
      if (result.isError === true) {
        // Why the subject has no world is in its open diagnostics (map preview preparation).
        const inspected = envelope(await call('modkit.inspect', { handle: on }))
        throw new Error(`world_scene failed: ${JSON.stringify(result.structuredContent)}; open: ${JSON.stringify(inspected.diagnostics)}`)
      }
      return envelope(result).data as Record<string, unknown>
    }
    // The edit guards the subject's revision (the open envelope's snapshotId); the world's own
    // snapshotId names the world snapshot and differs from it for an SC2 map.
    const opened = envelope(await call('modkit.open_subject', { path: copy }))
    const handle = (opened.data as { handle: string }).handle
    const info = (await world(handle, { view: 'info' })) as {
      snapshotId: string
      facets: { facet: string; layerId: string }[]
      edit?: { operationId: string; moveObjectKind: string }
    }
    if (info.edit === undefined) throw new Error('the SC2 world names no object edit')
    const layerId = info.facets.find(item => item.facet === 'objects')?.layerId
    type WorldObject = { id: string; objectId: number; position: { x: number; y: number; z: number } }
    const objectsOf = async (on: string) =>
      (await world(on, { view: 'page', facet: 'objects', layerId, limit: 20 }))['items'] as WorldObject[]
    const [first] = (await objectsOf(handle)).filter(item => typeof item.objectId === 'number')
    if (first === undefined) throw new Error('the SC2 map lists no object')

    const before = await files()
    const moved = { ...first.position, x: first.position.x + 1 }
    const proposal = envelope(
      await call('modkit.propose_edit', {
        handle,
        operationId: info.edit.operationId,
        input: {
          expectedSourceRevision: opened.snapshotId,
          edits: [{ kind: info.edit.moveObjectKind, objectId: first.objectId, patch: { position: moved } }],
        },
      }),
    )
    const planHandle = (proposal.data as { planHandle?: string } | null)?.planHandle
    if (planHandle === undefined) throw new Error(`no plan: ${JSON.stringify(proposal)}`)
    await call('modkit.prepare_edit', { planHandle })
    const committed = (envelope(await call('modkit.commit_edit', { planHandle })).data as {
      result: { state: string; receipt: { transactionId: string } }
    }).result
    expect(committed.state).toBe('committed')
    const after = await files()
    for (const [name, sum] of before) {
      if (name === 'Objects') expect(after.get(name)).not.toBe(sum)
      else expect(after.get(name), name).toBe(sum)
    }

    const reopened = (envelope(await call('modkit.open_subject', { path: copy })).data as { handle: string }).handle
    expect((await objectsOf(reopened)).find(item => item.id === first.id)?.position.x).toBeCloseTo(moved.x, 3)
    await call('modkit.close_subject', { handle: reopened })
    await call('modkit.undo_edit', { transactionId: committed.receipt.transactionId })
    expect(await files()).toEqual(before)
    await call('modkit.close_subject', { handle })
  }, 600_000)
})
