/**
 * F7 / Stage K: the MCP edit lifecycle over the host transaction, proven on installed SC2 codecs.
 *
 * Every write goes propose → prepare → commit through the host `CommitCoordinator`; the client
 * never sends bytes. Each format is then reopened, undone and redone from disk.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MapLayerDescriptor, MapLayerGrid } from '@modkit/sdk/maps'
import {
  createHostMcpPort,
  createModkitMcpServer,
  type McpEnvelope,
  type ModkitMcpHostPort,
} from '../src/index.js'

const coreRoot = resolve(import.meta.dirname, '..', '..', '..')
const blizzard = resolve(coreRoot, '..', 'modkit-extensions-blizzard', 'starcraft2')
const looseMod = resolve(coreRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-loose-mod')

let root: string
let host: ModkitMcpHostPort
let app: ReturnType<typeof createModkitMcpServer>
let client: Client
let readOnlyApp: ReturnType<typeof createModkitMcpServer>
let readOnlyClient: Client
const paths = { data: '', strings: '', layout: '', bank: '', uvw: '', uvwWorld: '' }
const uvwFixtures = resolve(coreRoot, 'vendor', 'multiverse-specs', 'specs', 'world', 'fixtures')
const uvwFixture = resolve(uvwFixtures, 'uvw-profile-single-space.uvw.json')

type CallResult = Awaited<ReturnType<Client['callTool']>>
const envelope = (value: CallResult) => value.structuredContent as McpEnvelope
const data = (value: CallResult) => (envelope(value).data ?? {}) as Record<string, unknown>
const firstCode = (value: CallResult) =>
  (envelope(value).diagnostics[0] as { code?: string } | undefined)?.code

async function connect(port: ModkitMcpHostPort) {
  const server = createModkitMcpServer(port)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const connected = new Client({ name: 'sc2-edit-lifecycle', version: '1.0.0' })
  await Promise.all([server.server.connect(serverTransport), connected.connect(clientTransport)])
  return { server, client: connected }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'modkit-mcp-sc2-edit-'))
  const mod = join(root, 'Probe.SC2Mod')
  paths.data = join(mod, 'Base.SC2Data', 'GameData', 'UnitData.xml')
  paths.strings = join(mod, 'enUS.SC2Data', 'LocalizedData', 'GameStrings.txt')
  paths.layout = join(mod, 'Base.SC2Data', 'UI', 'Layout', 'TechTreePanel_CNC.SC2Layout')
  paths.bank = join(root, 'Banks', 'endofdreamsbank2.SC2Bank')
  paths.uvw = join(root, 'World', 'terrain.uvw.json')
  paths.uvwWorld = join(root, 'World', 'objects.uvw.json')
  for (const path of Object.values(paths)) await mkdir(join(path, '..'), { recursive: true })
  await copyFile(resolve(uvwFixtures, 'uvw-profile-renderable-world.uvw.json'), paths.uvwWorld)
  // The specification fixture has one missing-ground sample; ground there makes the layer writable.
  const world = JSON.parse(await readFile(uvwFixture, 'utf8')) as { spaces: { layers: { samples: number[][] }[] }[] }
  world.spaces[0]!.layers[0]!.samples[2]![3] = 2
  await writeFile(paths.uvw, JSON.stringify(world, null, 2), 'utf8')
  const source = join(looseMod, 'Probe.SC2Mod')
  await copyFile(join(source, 'Base.SC2Data', 'GameData', 'UnitData.xml'), paths.data)
  await copyFile(join(source, 'enUS.SC2Data', 'LocalizedData', 'GameStrings.txt'), paths.strings)
  await copyFile(
    join(blizzard, 'test', 'fixtures', 'layout', 'TechTreePanel_CNC.SC2Layout'),
    paths.layout,
  )
  await copyFile(
    join(blizzard, 'modules', 'banks', 'test', 'fixtures', 'endofdreamsbank2.SC2Bank'),
    paths.bank,
  )
  host = await createHostMcpPort({ roots: [root], extensions: [blizzard], allowEdits: true })
  ;({ server: app, client } = await connect(host))
  // Same host, same plans API, no startup edit policy: commit/undo/redo must refuse.
  ;({ server: readOnlyApp, client: readOnlyClient } = await connect({
    ...host,
    editsEnabled: false,
  }))
}, 180_000)

afterAll(async () => {
  await Promise.allSettled([client?.close(), readOnlyClient?.close()])
  await Promise.allSettled([app?.dispose(), readOnlyApp?.dispose()])
  await host?.close()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
}, 60_000)

async function openSubject(path: string, codecId: string, via: Client = client): Promise<string> {
  const opened = data(await via.callTool({ name: 'modkit.open_subject', arguments: { path } }))
  let handle = opened['handle'] as string | undefined
  const candidates = (opened['selectionCandidates'] ?? []) as {
    candidateId: string
    codecId?: string
  }[]
  const candidate = candidates.find(item => item.codecId === codecId)
  if (candidate !== undefined && handle !== undefined) {
    const selected = data(
      await via.callTool({
        name: 'modkit.open_selection',
        arguments: { handle, selectionId: candidate.candidateId },
      }),
    )
    handle = selected['handle'] as string
  }
  if (typeof handle !== 'string') throw new Error(`${path} did not open: ${JSON.stringify(opened)}`)
  const inspected = data(await via.callTool({ name: 'modkit.inspect', arguments: { handle } }))
  expect(JSON.stringify(inspected)).toContain(codecId)
  return handle
}

async function revisionOf(handle: string): Promise<string> {
  return envelope(await client.callTool({ name: 'modkit.inspect', arguments: { handle } }))
    .snapshotId
}

async function propose(handle: string, operationId: string, input: unknown, via = client) {
  const result = await via.callTool({
    name: 'modkit.propose_edit',
    arguments: { handle, operationId, input },
  })
  const planHandle = data(result)['planHandle'] as string | undefined
  if (result.isError === true || planHandle === undefined) {
    throw new Error(`proposal failed: ${JSON.stringify(result.structuredContent)}`)
  }
  expect(data(result)['committed']).toBe(false)
  return planHandle
}

async function prepareAndCommit(planHandle: string): Promise<string> {
  const prepared = data(
    await client.callTool({ name: 'modkit.prepare_edit', arguments: { planHandle } }),
  )
  if (prepared['state'] !== 'ready') throw new Error(`prepare failed: ${JSON.stringify(prepared)}`)
  const committed = await client.callTool({ name: 'modkit.commit_edit', arguments: { planHandle } })
  const result = data(committed)['result'] as { state: string; receipt: { transactionId: string } }
  if (result?.state !== 'committed') throw new Error(`commit failed: ${JSON.stringify(committed)}`)
  return result.receipt.transactionId
}

interface Case {
  readonly name: keyof typeof paths
  readonly codecId: string
  readonly operationId: string
  readonly input: unknown
  readonly before: string
  readonly after: string
}

const cases: readonly Case[] = [
  {
    name: 'data',
    codecId: 'blizzard/sc2-data',
    operationId: 'edit.field',
    input: { path: ['Unit', 'Marine', 'LifeMax'], value: '55' },
    before: '<LifeMax value="45"/>',
    after: '<LifeMax value="55"/>',
  },
  {
    name: 'strings',
    codecId: 'blizzard/sc2-strings',
    operationId: 'edit.field',
    input: { path: ['keys', 'Unit/Name/Marine'], value: 'Space Marine' },
    before: 'Unit/Name/Marine=Marine',
    after: 'Unit/Name/Marine=Space Marine',
  },
  {
    name: 'layout',
    codecId: 'blizzard/sc2-layout',
    operationId: 'edit.content',
    input: {
      namespace: 'UI',
      oldId: 'UnitListBackgroundImage_Crimson',
      newId: 'UnitListBackgroundImage_Blue',
    },
    before: 'val="@UI/UnitListBackgroundImage_Crimson"',
    after: 'val="@UI/UnitListBackgroundImage_Blue"',
  },
  {
    name: 'bank',
    codecId: 'blizzard/sc2-bank',
    operationId: 'edit.field',
    input: { path: ['Ranks', 'Rank'], value: 'Legend' },
    before: '<Value string="Hero"/>',
    after: '<Value string="Legend"/>',
  },
]

describe('MCP edit lifecycle over installed SC2 writers', () => {
  for (const item of cases) {
    it(`${item.name}: propose → prepare → commit → history → reopen → undo → redo`, async () => {
      const path = paths[item.name]
      const original = await readFile(path, 'utf8')
      expect(original).toContain(item.before)
      const handle = await openSubject(path, item.codecId)
      const planHandle = await propose(handle, item.operationId, item.input)
      // Proposal and validation never touch the source.
      expect(await readFile(path, 'utf8')).toBe(original)
      const transactionId = await prepareAndCommit(planHandle)
      const written = await readFile(path, 'utf8')
      expect(written).toContain(item.after)
      expect(written).not.toContain(item.before)

      const history = data(
        await client.callTool({ name: 'modkit.edit_history', arguments: { limit: 100 } }),
      )
      expect(JSON.stringify(history['items'])).toContain(transactionId)

      // Reopen from disk: the codec reads a new source revision.
      const reopened = await openSubject(path, item.codecId)
      expect(await revisionOf(reopened)).not.toBe(await revisionOf(handle))
      await client.callTool({ name: 'modkit.close_subject', arguments: { handle: reopened } })

      const undone = data(
        await client.callTool({ name: 'modkit.undo_edit', arguments: { transactionId } }),
      )
      expect(undone['result']).toMatchObject({ state: 'committed' })
      expect(await readFile(path, 'utf8')).toBe(original)
      const redone = data(
        await client.callTool({ name: 'modkit.redo_edit', arguments: { transactionId } }),
      )
      expect(redone['result']).toMatchObject({ state: 'committed' })
      expect(await readFile(path, 'utf8')).toBe(written)

      // A redo is a new transaction; undoing it leaves the fixture as it started.
      const redoId = (redone['result'] as { receipt: { transactionId: string } }).receipt
        .transactionId
      const undoneRedo = data(
        await client.callTool({ name: 'modkit.undo_edit', arguments: { transactionId: redoId } }),
      )
      expect(undoneRedo['result']).toMatchObject({ state: 'committed' })
      expect(await readFile(path, 'utf8')).toBe(original)
      const discarded = data(
        await client.callTool({ name: 'modkit.discard_edit', arguments: { id: redoId } }),
      )
      expect(discarded).toMatchObject({ kind: 'history', discarded: true })
      await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
    }, 180_000)
  }

  it('map layer: read a window → write it → commit → reopen → image → undo; the older plan goes stale', async () => {
    const path = paths.uvw
    const original = await readFile(path, 'utf8')
    const handle = await openSubject(path, 'modkit/world-uvw')
    const invoke = async (on: string, operationId: string, input: unknown, render?: 'image') => {
      const result = await client.callTool({
        name: 'modkit.invoke_readonly',
        arguments: { handle: on, operationId, input, ...(render === undefined ? {} : { render }) },
      })
      if (result.isError === true) throw new Error(`${operationId} failed: ${JSON.stringify(result.structuredContent)}`)
      return { result, value: (data(result)['result'] as { output: { value: unknown } }).output.value }
    }
    const layerOf = async (on: string) =>
      ((await invoke(on, 'map.layers', {})).value as { layers: MapLayerDescriptor[] }).layers[0]!
    const imageOf = (result: CallResult) =>
      (result.content as { type: string; mimeType?: string; data?: string }[]).find(item => item.type === 'image')
    const layer = await layerOf(handle)
    expect(layer).toMatchObject({ id: 'main/terrain', meaning: 'height', editable: true, unit: 'm', sampling: 'vertex' })
    // A client learns the window and value fields from the descriptor, not from Modkit's sources.
    const inspection = await client.callTool({ name: 'modkit.inspect', arguments: { handle } })
    expect(envelope(inspection).completeness).toBe('complete')
    const inspected = data(inspection)
    const operations = (inspected['descriptor'] as { operations: { id: string; inputSchema?: { $ref: string; document?: unknown } }[] }).operations
    expect(operations.find(item => item.id === 'map.layer-read')?.inputSchema).toMatchObject({
      $ref: 'modkit://map/layer-read.v1',
      document: { required: ['layer'] },
    })
    const world = (on: MapLayerDescriptor, n: number) => (on.valueOffset ?? 0) + n * (on.valueScale ?? 1)
    const sample = (height: number) => Math.round((height - (layer.valueOffset ?? 0)) / (layer.valueScale ?? 1))

    const window = { layer: layer.id, x: 1, y: 1, width: 2, height: 2 }
    const read = await invoke(handle, 'map.layer-read', window)
    expect((read.value as MapLayerGrid).values.map(n => world(layer, n))).toEqual([0.75, 1.25, 1, 1.5])
    const before = await invoke(handle, 'map.layer-read', { layer: layer.id }, 'image')
    expect(imageOf(before.result)).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(data(before.result)['render']).toMatchObject({ kind: 'grey' })

    const write = { ...window, values: [3, 3, 3, 3].map(sample) }
    const planHandle = await propose(handle, 'map.layer-write', write)
    const olderPlan = await propose(handle, 'map.layer-write', { ...write, values: [0, 0, 0, 0].map(sample) })
    expect(await readFile(path, 'utf8')).toBe(original)
    const transactionId = await prepareAndCommit(planHandle)
    const written = await readFile(path, 'utf8')
    expect(written).not.toBe(original)

    // A plan made against the revision before the commit is refused, not merged.
    const stale = await client.callTool({ name: 'modkit.prepare_edit', arguments: { planHandle: olderPlan } })
    expect(envelope(stale).completeness).toBe('invalid')
    expect(await readFile(path, 'utf8')).toBe(written)
    await client.callTool({ name: 'modkit.discard_edit', arguments: { id: olderPlan } })

    const reopened = await openSubject(path, 'modkit/world-uvw')
    expect(await revisionOf(reopened)).not.toBe(await revisionOf(handle))
    const reread = await invoke(reopened, 'map.layer-read', window)
    const newLayer = await layerOf(reopened)
    expect((reread.value as MapLayerGrid).values.map(n => world(newLayer, n))).toEqual([3, 3, 3, 3])
    const after = await invoke(reopened, 'map.layer-read', { layer: layer.id }, 'image')
    expect(imageOf(after.result)?.data).not.toBe(imageOf(before.result)?.data)
    await client.callTool({ name: 'modkit.close_subject', arguments: { handle: reopened } })

    const undone = data(await client.callTool({ name: 'modkit.undo_edit', arguments: { transactionId } }))
    expect(undone['result']).toMatchObject({ state: 'committed' })
    expect(await readFile(path, 'utf8')).toBe(original)
    await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
  }, 180_000)

  it('map objects: list them, move one through the world edit, commit, reopen, undo', async () => {
    const path = paths.uvwWorld
    const original = await readFile(path, 'utf8')
    const handle = await openSubject(path, 'modkit/world-uvw')
    const world = async (on: string, query: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'modkit.world_scene', arguments: { handle: on, ...query } })
      if (result.isError === true) throw new Error(`world_scene failed: ${JSON.stringify(result.structuredContent)}`)
      return data(result)
    }
    // The world names its facet layers and the edit that moves an object; the client takes both as given.
    const info = (await world(handle, { view: 'info' })) as {
      snapshotId: string
      facets: { facet: string; layerId: string }[]
      edit?: { operationId: string; moveObjectKind: string }
    }
    expect(info.edit).toEqual({ operationId: 'edit.structure', moveObjectKind: 'object.update' })
    const layerOf = (facet: string) => info.facets.find(item => item.facet === facet)?.layerId
    type WorldObject = { id: string; objectId: number; position: { x: number; y: number; z: number } }
    const objectsOf = async (on: string) =>
      (await world(on, { view: 'page', facet: 'objects', layerId: layerOf('objects'), limit: 20 }))[
        'items'
      ] as WorldObject[]
    const regions = await world(handle, { view: 'page', facet: 'regions', layerId: layerOf('regions'), limit: 20 })
    expect(regions).toMatchObject({ state: 'available' })
    expect((regions['items'] as unknown[]).length).toBeGreaterThan(0)
    const [first] = await objectsOf(handle)
    if (first === undefined || info.edit === undefined) throw new Error('the world lists no movable object')
    const moved = { x: first.position.x + 1.5, y: first.position.y, z: first.position.z - 0.25 }
    const planHandle = await propose(handle, info.edit.operationId, {
      expectedSourceRevision: info.snapshotId,
      edits: [{ kind: info.edit.moveObjectKind, objectId: first.objectId, patch: { position: moved } }],
    })
    expect(await readFile(path, 'utf8')).toBe(original)
    const transactionId = await prepareAndCommit(planHandle)

    const reopened = await openSubject(path, 'modkit/world-uvw')
    const after = await objectsOf(reopened)
    expect(after.find(item => item.id === first.id)?.position).toEqual(moved)
    await client.callTool({ name: 'modkit.close_subject', arguments: { handle: reopened } })
    const undone = data(await client.callTool({ name: 'modkit.undo_edit', arguments: { transactionId } }))
    expect(undone['result']).toMatchObject({ state: 'committed' })
    expect(await readFile(path, 'utf8')).toBe(original)
    await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
  }, 180_000)

  it('refuses a plan whose source changed after the proposal (stale revision)', async () => {
    const handle = await openSubject(paths.data, 'blizzard/sc2-data')
    const planHandle = await propose(handle, 'edit.field', {
      path: ['Unit', 'Marine', 'LifeMax'],
      value: '60',
    })
    const original = await readFile(paths.data, 'utf8')
    const external = original.replace('value="45"', 'value="46"')
    await writeFile(paths.data, external, 'utf8')
    try {
      const prepared = await client.callTool({
        name: 'modkit.prepare_edit',
        arguments: { planHandle },
      })
      const commit = await client.callTool({
        name: 'modkit.commit_edit',
        arguments: { planHandle },
      })
      // The host re-reads revisions at prepare and names the conflicting binding.
      expect(envelope(prepared).completeness).toBe('invalid')
      expect(JSON.stringify(data(prepared)['conflicts'])).toContain('UnitData')
      expect(commit.isError).toBe(true)
      expect(firstCode(commit)).toBe('x3.mcp/edit-not-prepared')
      expect(await readFile(paths.data, 'utf8')).toBe(external)
    } finally {
      await writeFile(paths.data, original, 'utf8')
      await client.callTool({ name: 'modkit.discard_edit', arguments: { id: planHandle } })
      await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
    }
  }, 180_000)

  it('refuses commit without the startup edit policy and tampered or replayed plan handles', async () => {
    const before = await readFile(paths.strings, 'utf8')
    const handle = await openSubject(paths.strings, 'blizzard/sc2-strings', readOnlyClient)
    const planHandle = await propose(
      handle,
      'edit.field',
      { path: ['keys', 'Unit/Name/Marine'], value: 'Denied' },
      readOnlyClient,
    )
    const prepared = data(
      await readOnlyClient.callTool({ name: 'modkit.prepare_edit', arguments: { planHandle } }),
    )
    expect(prepared['state']).toBe('ready')
    const denied = await readOnlyClient.callTool({
      name: 'modkit.commit_edit',
      arguments: { planHandle },
    })
    expect(denied.isError).toBe(true)
    expect(firstCode(denied)).toBe('x3.mcp/edit-commit-disabled')
    const deniedUndo = await readOnlyClient.callTool({
      name: 'modkit.undo_edit',
      arguments: { transactionId: 'any' },
    })
    expect(firstCode(deniedUndo)).toBe('x3.mcp/edit-commit-disabled')

    // A handle from another server, or one altered by the client, is unknown here.
    const foreign = await client.callTool({ name: 'modkit.commit_edit', arguments: { planHandle } })
    expect(firstCode(foreign)).toBe('x3.mcp/unknown-edit-plan')
    const tampered = `${planHandle.slice(0, -1)}${planHandle.endsWith('0') ? '1' : '0'}`
    const forged = await readOnlyClient.callTool({
      name: 'modkit.prepare_edit',
      arguments: { planHandle: tampered },
    })
    expect(firstCode(forged)).toBe('x3.mcp/unknown-edit-plan')
    // Client bytes have no route: the schema rejects any payload field.
    const smuggled = await readOnlyClient.callTool({
      name: 'modkit.commit_edit',
      arguments: { planHandle, payload: 'AAAA' },
    })
    expect(smuggled.isError).toBe(true)

    const discarded = data(
      await readOnlyClient.callTool({ name: 'modkit.discard_edit', arguments: { id: planHandle } }),
    )
    expect(discarded).toMatchObject({ kind: 'plan', discarded: true })
    const replay = await readOnlyClient.callTool({
      name: 'modkit.prepare_edit',
      arguments: { planHandle },
    })
    expect(firstCode(replay)).toBe('x3.mcp/unknown-edit-plan')
    expect(await readFile(paths.strings, 'utf8')).toBe(before)
    await readOnlyClient.callTool({ name: 'modkit.close_subject', arguments: { handle } })
  }, 180_000)

  it('releases retained plans when their subject closes', async () => {
    const handle = await openSubject(paths.bank, 'blizzard/sc2-bank')
    const planHandle = await propose(handle, 'edit.field', {
      path: ['Ranks', 'Rank'],
      value: 'Gone',
    })
    await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
    const prepared = await client.callTool({
      name: 'modkit.prepare_edit',
      arguments: { planHandle },
    })
    expect(prepared.isError).toBe(true)
    expect(['x3.mcp/unknown-edit-plan', 'x3.mcp/editing-unavailable']).toContain(
      firstCode(prepared),
    )
  }, 180_000)
})
