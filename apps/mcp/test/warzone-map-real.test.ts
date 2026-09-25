/**
 * A2: a Warzone 2100 map's height window through the same MCP route as UVW, on the installed game.
 * The map comes out of mp.wz by the extension's own discovery and Modkit's ZIP reader; everything
 * after that is MCP: open, layers, read, image, propose, prepare, commit, reopen, a stale plan, undo.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MapLayerDescriptor, MapLayerGrid } from '@modkit/sdk/maps'
import { extractZipArchiveEntry, parseZipArchive } from '../../../extensions/archives/src/zip/codec.js'
import { discoverWarzone2100Installations } from '../../../../modkit-extensions-warzone/src/provider.js'
import { createHostMcpPort, createModkitMcpServer, type McpEnvelope, type ModkitMcpHostPort } from '../src/index.js'

const coreRoot = resolve(import.meta.dirname, '..', '..', '..')
const warzoneRoot = resolve(coreRoot, '..', 'modkit-extensions-warzone')
const mapEntry = 'multiplay/maps/2c-highground/game.map'
let root: string
let mapPath: string
let host: ModkitMcpHostPort
let app: ReturnType<typeof createModkitMcpServer>
let client: Client

type CallResult = Awaited<ReturnType<Client['callTool']>>
const envelope = (value: CallResult) => value.structuredContent as McpEnvelope
const data = (value: CallResult) => (envelope(value).data ?? {}) as Record<string, unknown>

beforeAll(async () => {
  const discovery = await discoverWarzone2100Installations({ gameId: 'wz2100project/warzone-2100', maxCandidates: 128 })
  const archivePath = discovery.installations
    .flatMap((installation: { evidence: { kind: string; found: boolean; path?: string }[] }) => installation.evidence)
    .find(item => item.kind === 'warzone-mp-archive' && item.found)?.path
  if (archivePath === undefined) throw new Error('installed Warzone mp.wz was not discovered')
  const archive = await readFile(archivePath)
  const entry = parseZipArchive(archive, 20_000).find(
    (item: { kind: string; name: string }) => item.kind === 'file' && item.name.toLowerCase() === mapEntry,
  )
  if (entry === undefined) throw new Error(`${mapEntry} is absent from installed mp.wz`)
  root = await mkdtemp(join(tmpdir(), 'modkit-mcp-warzone-map-'))
  mapPath = join(root, '2c-highground', 'game.map')
  await mkdir(join(mapPath, '..'), { recursive: true })
  await writeFile(mapPath, await extractZipArchiveEntry(archive, entry))
  // A game extension shipped with the product vouches for its writer; one the user adds does not.
  host = await createHostMcpPort({ roots: [root], extensions: [warzoneRoot], trustExtensions: true, allowEdits: true })
  app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'warzone-map-real', version: '1.0.0' })
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
}, 180_000)

afterAll(async () => {
  await Promise.allSettled([client?.close(), app?.dispose()])
  await host?.close()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
}, 60_000)

async function open(path: string): Promise<string> {
  const opened = data(await client.callTool({ name: 'modkit.open_subject', arguments: { path } }))
  let handle = opened['handle'] as string | undefined
  const candidate = ((opened['selectionCandidates'] ?? []) as { candidateId: string; codecId?: string }[]).find(
    item => item.codecId === 'modkit/warzone2100-map',
  )
  if (candidate !== undefined && handle !== undefined)
    handle = data(
      await client.callTool({ name: 'modkit.open_selection', arguments: { handle, selectionId: candidate.candidateId } }),
    )['handle'] as string
  if (typeof handle !== 'string') throw new Error(`${path} did not open: ${JSON.stringify(opened)}`)
  return handle
}

async function invoke(handle: string, operationId: string, input: unknown, render?: 'image') {
  const result = await client.callTool({
    name: 'modkit.invoke_readonly',
    arguments: { handle, operationId, input, ...(render === undefined ? {} : { render }) },
  })
  if (result.isError === true) throw new Error(`${operationId} failed: ${JSON.stringify(result.structuredContent)}`)
  return { result, value: (data(result)['result'] as { output: { value: unknown } }).output.value }
}

async function propose(handle: string, input: unknown): Promise<string> {
  const result = await client.callTool({
    name: 'modkit.propose_edit',
    arguments: { handle, operationId: 'map.layer-write', input },
  })
  const planHandle = data(result)['planHandle']
  if (result.isError === true || typeof planHandle !== 'string')
    throw new Error(`proposal failed: ${JSON.stringify(result.structuredContent)}`)
  return planHandle
}

const imageOf = (result: CallResult) =>
  (result.content as { type: string; mimeType?: string; data?: string }[]).find(item => item.type === 'image')

describe('installed Warzone map height through generic MCP', () => {
  it('reads a window, writes it, commits, reopens, refuses a stale plan and undoes', async () => {
    const original = await readFile(mapPath)
    const handle = await open(mapPath)
    const inspection = await client.callTool({ name: 'modkit.inspect', arguments: { handle } })
    expect(envelope(inspection).completeness).toBe('complete')
    const operations = (data(inspection)['descriptor'] as { operations: { id: string; inputSchema?: { $ref: string } }[] })
      .operations
    expect(operations.find(item => item.id === 'map.layer-write')?.inputSchema?.$ref).toBe('modkit://map/layer-write.v1')
    const layer = ((await invoke(handle, 'map.layers', {})).value as { layers: MapLayerDescriptor[] }).layers.find(
      item => item.meaning === 'height',
    )
    if (layer === undefined) throw new Error('the Warzone map lists no height layer')
    expect(layer).toMatchObject({ editable: true, sampling: 'vertex', unit: 'warzone-world-unit' })

    const window = { layer: layer.id, x: 10, y: 10, width: 3, height: 2 }
    const read = (await invoke(handle, 'map.layer-read', window)).value as MapLayerGrid
    expect(read).toMatchObject({ x: 10, y: 10, width: 3, height: 2 })
    const before = await invoke(handle, 'map.layer-read', { layer: layer.id }, 'image')
    expect(imageOf(before.result)).toMatchObject({ type: 'image', mimeType: 'image/png' })

    const values = read.values.map(value => (value === layer.maximum ? value - 1 : value + 1))
    const planHandle = await propose(handle, { ...window, values })
    const olderPlan = await propose(handle, { ...window, values: read.values.map(() => layer.minimum) })
    expect(await readFile(mapPath)).toEqual(original)
    const prepared = data(await client.callTool({ name: 'modkit.prepare_edit', arguments: { planHandle } }))
    if (prepared['state'] !== 'ready') throw new Error(`prepare failed: ${JSON.stringify(prepared)}`)
    const committed = data(await client.callTool({ name: 'modkit.commit_edit', arguments: { planHandle } }))
    const receipt = committed['result'] as { state: string; receipt: { transactionId: string } }
    if (receipt?.state !== 'committed') throw new Error(`commit failed: ${JSON.stringify(committed)}`)
    const written = await readFile(mapPath)
    // Only the six written heights move; one byte each below game.map version 40, two from 40.
    const moved = written.reduce((count, byte, index) => count + (byte === original[index] ? 0 : 1), 0)
    expect(written.byteLength).toBe(original.byteLength)
    expect(moved).toBeGreaterThanOrEqual(6)
    expect(moved).toBeLessThanOrEqual(12)

    const stale = await client.callTool({ name: 'modkit.prepare_edit', arguments: { planHandle: olderPlan } })
    expect(envelope(stale).completeness).toBe('invalid')
    await client.callTool({ name: 'modkit.discard_edit', arguments: { id: olderPlan } })

    const reopened = await open(mapPath)
    expect(((await invoke(reopened, 'map.layer-read', window)).value as MapLayerGrid).values).toEqual(values)
    const after = await invoke(reopened, 'map.layer-read', { layer: layer.id }, 'image')
    expect(imageOf(after.result)?.data).not.toBe(imageOf(before.result)?.data)
    await client.callTool({ name: 'modkit.close_subject', arguments: { handle: reopened } })

    const undone = data(
      await client.callTool({ name: 'modkit.undo_edit', arguments: { transactionId: receipt.receipt.transactionId } }),
    )
    expect(undone['result']).toMatchObject({ state: 'committed' })
    expect(await readFile(mapPath)).toEqual(original)
    await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
  }, 180_000)
})
