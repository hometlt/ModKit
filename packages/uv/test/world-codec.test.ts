import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type ContributionContext,
  type ResourceBudget,
  type WorldSceneSource,
} from '@modkit/sdk'
import {
  MAP_LAYER_WRITE_INPUT_SCHEMA,
  NATIVE_MAP_ENCODER_CONTRACT,
  type MapLayerDescriptor,
  type MapLayerGrid,
} from '@modkit/sdk/maps'
import { createCodec } from '../src/world/codec.js'
import { parseUvwProfile } from '../src/world/index.js'

const budget: ResourceBudget = {
  maxInputBytes: 64n * 1024n * 1024n,
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxScalarBytes: 128 * 1024 * 1024,
  maxDiagnostics: 1_000,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new TypeError('UVW codec has no service dependency')
    },
    async resolveUnknown() {
      throw new TypeError('UVW codec has no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array): ArtifactByteSource {
  const revision = revisionId('content-hash.sha256:uvw-codec-fixture')
  return {
    kind: 'bytes',
    ref: { id: 'uvw-fixture', uri: 'memory://world/example.uvw' },
    revision,
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(asset: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: asset.ref,
    revision: asset.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: asset.revision,
      bindings: [{ bindingId: binding.bindingId, revision: asset.revision }],
      compositionFingerprint: 'uvw-codec-fixture',
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: asset, async release() {} }
    },
  }
}

describe('UVW host codec', () => {
  it('detects and opens a normal .uvw asset with world, tree, text and byte sources', async () => {
    const bytes = await readFile(
      fileURLToPath(
        new URL(
          '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-single-space.uvw.json',
          import.meta.url,
        ),
      ),
    )
    const asset = source(bytes)
    const codec = createCodec(context)
    const detection = await codec.probe({
      source: asset,
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 65_536 }], maxBytes: 65_536 },
    })
    expect(detection).toMatchObject({ codecId: 'modkit/world-uvw', confidence: 0.995 })

    const session = await codec.open(inputFor(asset), 'full', budget)
    const descriptor = await session.descriptor()
    expect(descriptor.interpretation).toBe('codec')
    if (descriptor.interpretation !== 'codec') throw new Error('UVW codec did not resolve')
    expect(descriptor.identity).toMatchObject({ codecId: 'modkit/world-uvw', formatId: 'uvw' })
    expect(descriptor.operations.map(item => item.id)).toEqual(
      expect.arrayContaining(['edit.field', 'edit.structure', 'map.export-uvw']),
    )
    expect(descriptor.dataSources.map(item => item.contract)).toEqual(
      expect.arrayContaining([
        'common.view/world-scene-source',
        'common.view/tree-data-source',
        'common.view/text-data-source',
        'common.view/byte-range-source',
      ]),
    )
    const lease = await session.dataSource('common.view/world-scene-source', 1)
    const world = lease.value as WorldSceneSource
    const info = await world.info()
    expect(info).toMatchObject({
      contract: 'common.view/world-scene-source',
      snapshotId: asset.revision,
      complete: true,
    })
    expect(info.edit).toBeUndefined()
    const layers = await world.page({ facet: 'layers', limit: 16 })
    expect(layers.items).toHaveLength(1)
    const exported = await session.operations().invoke('export-canonical-uvw', null)
    expect(exported.state, JSON.stringify(exported)).toBe('ok')
    if (exported.state === 'ok' && exported.output.kind === 'bytes') {
      expect(new TextDecoder().decode(exported.output.value).endsWith('\n')).toBe(true)
    }

    const edited = await session.operations().invoke('edit-uvw-document', {
      json: [{ op: 'replace', path: '/spaces/0/layers/0/samples/0/0', value: 1.25 }],
    })
    expect(edited.state).toBe('ok')
    if (edited.state !== 'ok' || edited.output.kind !== 'edit-plan')
      throw new Error('UVW document edit did not produce an edit plan')
    expect(edited.output.plan.fidelity).toMatchObject({
      roundTrip: 'semantic',
      preservesUnknownData: true,
    })
    const replacement = edited.output.plan.edits[0]
    if (replacement?.operation !== 'replace' || replacement.payload.kind !== 'inline')
      throw new Error('UVW edit did not replace the source bytes')
    expect(replacement.range).toEqual({ kind: 'bytes', offset: 0n, length: BigInt(bytes.length) })
    const editedDocument = parseUvwProfile(replacement.payload.bytes)
    const terrain = editedDocument.spaces[0]?.layers[0]
    expect(terrain?.kind).toBe('heightfield')
    if (terrain?.kind === 'heightfield') expect(terrain.samples[0]?.[0]).toBe(1.25)

    const fieldEdited = await session.operations().invoke('set-uvw-field', {
      groupId: 'tree',
      key: '0',
      path: ['spaces', '0', 'layers', '0', 'samples', '0', '0'],
      value: 2.5,
    })
    expect(fieldEdited.state).toBe('ok')
    await expect(
      session.operations().invoke('edit-uvw-document', {
        json: [{ op: 'add', path: '/spaces/0/unrecognized', value: true }],
      }),
    ).rejects.toThrow(/unrecognized/u)
    await lease.release()
    await session.dispose()
  }, 20_000)

  it('publishes and executes the UI object.update route by stable canonical object identity', async () => {
    const fixtureBytes = await readFile(
      fileURLToPath(
        new URL(
          '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-renderable-world.uvw.json',
          import.meta.url,
        ),
      ),
    )
    const fixture = JSON.parse(new TextDecoder().decode(fixtureBytes)) as {
      spaces: { layers: { kind: string; instances?: unknown[] }[] }[]
    }
    const rawObjects = fixture.spaces
      .flatMap(space => space.layers)
      .find(layer => layer.kind === 'objects')
    if (rawObjects?.instances === undefined) throw new Error('UVW fixture objects layer is missing')
    rawObjects.instances.reverse()
    const bytes = new TextEncoder().encode(JSON.stringify(fixture))
    const asset = source(bytes)
    const session = await createCodec(context).open(inputFor(asset), 'full', budget)
    const lease = await session.dataSource('common.view/world-scene-source', 1)
    const world = lease.value as WorldSceneSource
    const info = await world.info()
    expect(info.edit).toEqual({
      operationId: 'edit.structure',
      moveObjectKind: 'object.update',
    })
    const page = await world.page({ facet: 'objects', layerId: 'main/objects', limit: 16 })
    const selected = page.items[0]
    expect(selected).toMatchObject({ facet: 'objects', objectId: 0, id: 'main/objects:instance-a' })

    const edited = await session.operations().invoke('edit-uvw-document', {
      expectedSourceRevision: asset.revision,
      edits: [
        {
          kind: 'object.update',
          objectId: 0,
          patch: { position: { x: 4.25, y: 5.5, z: 6.75 } },
        },
      ],
    })
    expect(edited.state).toBe('ok')
    if (edited.state !== 'ok' || edited.output.kind !== 'edit-plan')
      throw new Error('UVW object edit did not produce an edit plan')
    const replacement = edited.output.plan.edits[0]
    if (replacement?.operation !== 'replace' || replacement.payload.kind !== 'inline')
      throw new Error('UVW object edit did not replace the source bytes')
    const document = parseUvwProfile(replacement.payload.bytes)
    const objects = document.spaces
      .flatMap(space => space.layers)
      .find(layer => layer.kind === 'objects')
    if (objects?.kind !== 'objects') throw new Error('edited UVW objects layer is missing')
    expect(objects.instances.find(instance => instance.id === 'instance-a')?.position).toEqual([
      4.25, 5.5, 6.75,
    ])
    expect(objects.instances.find(instance => instance.id === 'instance-b')?.position).toEqual([
      0.75, 2.5, 0.75,
    ])
    await expect(
      session.operations().invoke('edit-uvw-document', {
        expectedSourceRevision: 'content-hash.sha256:stale',
        edits: [
          {
            kind: 'object.update',
            objectId: 0,
            patch: { position: { x: 0, y: 0, z: 0 } },
          },
        ],
      }),
    ).rejects.toThrow(/stale.*revision/iu)
    await lease.release()
    await session.dispose()
  }, 20_000)
})

describe('UVW height as a map layer', () => {
  const fixtureUrl = new URL(
    '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-single-space.uvw.json',
    import.meta.url,
  )
  // The fixture's heights are quarters of a metre, and one sample is missing ground (-9999).
  async function open(fill?: number) {
    const fixture = JSON.parse(await readFile(fileURLToPath(fixtureUrl), 'utf8')) as {
      spaces: { layers: { samples?: number[][] }[] }[]
    }
    const samples = fixture.spaces[0]?.layers[0]?.samples
    if (fill !== undefined && samples?.[2] !== undefined) samples[2][3] = fill
    const asset = source(new TextEncoder().encode(JSON.stringify(fixture)))
    const session = await createCodec(context).open(inputFor(asset), 'full', budget)
    const invoke = async (handler: string, input: unknown) => {
      const result = await session.operations().invoke(handler, input as never)
      if (result.state !== 'ok') throw new Error(JSON.stringify(result))
      return result.output
    }
    return { asset, session, invoke }
  }

  it('reads and writes a window of heights exactly on a power-of-two grid', async () => {
    const { asset, session, invoke } = await open(2)
    const descriptor = await session.descriptor()
    expect(descriptor.operations.map(item => item.id)).toEqual(
      expect.arrayContaining(['map.layers', 'map.layer-read', 'map.layer-write']),
    )
    // The input shape is the SDK's one schema.
    expect(descriptor.operations.find(item => item.id === 'map.layer-write')?.inputSchema).toEqual(
      MAP_LAYER_WRITE_INPUT_SCHEMA,
    )
    const listed = await invoke('map-layers', null)
    if (listed.kind !== 'json') throw new Error('map.layers is not JSON')
    const [layer] = (listed.value as unknown as { layers: MapLayerDescriptor[] }).layers
    expect(layer).toMatchObject({
      id: 'main/terrain', meaning: 'height', width: 5, height: 4, minimum: 0, maximum: 0xffff,
      editable: true, valueScale: 1 / 256, unit: 'm', sampling: 'vertex',
    })
    if (layer === undefined) throw new Error('the height layer is missing')
    const world = (n: number) => (layer.valueOffset ?? 0) + n * (layer.valueScale ?? 1)
    const sample = (height: number) => Math.round((height - (layer.valueOffset ?? 0)) / (layer.valueScale ?? 1))

    const read = await invoke('map-layer-read', { layer: layer.id, x: 1, y: 1, width: 2, height: 2 })
    if (read.kind !== 'json') throw new Error('map.layer-read is not JSON')
    const grid = read.value as unknown as MapLayerGrid
    expect(grid).toMatchObject({ layer: 'main/terrain', x: 1, y: 1, width: 2, height: 2 })
    expect(grid.values.map(world)).toEqual([0.75, 1.25, 1, 1.5])

    const written = await invoke('map-layer-write', {
      layer: layer.id, x: 1, y: 2, width: 2, height: 1, values: [sample(3.5), sample(-1)],
      expectedSourceRevision: asset.revision,
    })
    if (written.kind !== 'edit-plan') throw new Error('map.layer-write did not plan an edit')
    const replacement = written.plan.edits[0]
    if (replacement?.operation !== 'replace' || replacement.payload.kind !== 'inline')
      throw new Error('the height write did not replace the source bytes')
    const terrain = parseUvwProfile(replacement.payload.bytes).spaces[0]?.layers[0]
    if (terrain?.kind !== 'heightfield') throw new Error('the edited heightfield is missing')
    expect(terrain.samples).toEqual([
      [0, 0.5, 1, 1.5, 2],
      [0.25, 0.75, 1.25, 1.75, 2.25],
      [0.5, 3.5, -1, 2, 2.5],
      [0.75, 1.25, 1.75, 2.25, 2.75],
    ])

    await expect(invoke('map-layer-write', { layer: layer.id, x: 4, y: 3, width: 2, height: 1, values: [0, 0] }))
      .rejects.toThrow(/leaves the 5x4 layer/u)
    await expect(invoke('map-layer-write', { layer: layer.id, x: 0, y: 0, width: 1, height: 1, values: [0.5] }))
      .rejects.toThrow(/from 0 to 65535/u)
    await expect(invoke('map-layer-write', {
      layer: layer.id, x: 0, y: 0, width: 1, height: 1, values: [0], expectedSourceRevision: 'content-hash.sha256:stale',
    })).rejects.toThrow(/stale UVW source revision/u)
    await session.dispose()
  }, 20_000)

  it('keeps a layer with missing ground readable but not writable', async () => {
    const { session, invoke } = await open()
    const listed = await invoke('map-layers', null)
    if (listed.kind !== 'json') throw new Error('map.layers is not JSON')
    expect((listed.value as unknown as { layers: MapLayerDescriptor[] }).layers[0]?.editable).toBe(false)
    const descriptor = await session.descriptor()
    expect(descriptor.diagnostics.map(item => item.code)).toContain('modkit/uvw-height-layer-inexact')
    await expect(invoke('map-layer-write', { layer: 'main/terrain', width: 1, height: 1, x: 0, y: 0, values: [0] }))
      .rejects.toThrow(/read-only/u)
    await session.dispose()
  }, 20_000)
})

describe('UVW written as a game map (WT10)', () => {
  const fixture = () =>
    readFile(
      fileURLToPath(
        new URL(
          '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-single-space.uvw.json',
          import.meta.url,
        ),
      ),
    )
  // the host's contract port, handing out the one encoder it was given
  const encoding = (encoder: unknown, requests: unknown[]): ContributionContext => ({
    ...context,
    contracts: {
      async resolve(request) {
        requests.push(request)
        return { value: encoder as never, async release() {} }
      },
      async resolveUnknown() {
        throw new TypeError('UVW codec has no foreign service dependency')
      },
    },
  })

  it('writes the world with the encoder of the asked format and reports its losses', async () => {
    const bytes = await fixture()
    const requests: unknown[] = []
    let received: Uint8Array | undefined
    const encoder = {
      contract: NATIVE_MAP_ENCODER_CONTRACT,
      formatId: 'ra2-map',
      extension: 'map',
      async encode(request: { readonly uvw: Uint8Array }) {
        received = request.uvw
        return {
          formatId: 'ra2-map',
          extension: 'map',
          bytes: Uint8Array.of(1, 2, 3),
          diagnostics: [
            { severity: 'warning', code: 'westwood/uvw-object-untyped', message: 'no rules type' },
          ],
        }
      },
    }
    const session = await createCodec(encoding(encoder, requests)).open(
      inputFor(source(bytes)),
      'full',
      budget,
    )
    const descriptor = await session.descriptor()
    expect(descriptor.operations.map(item => item.id)).toContain('map.export-native')
    const result = await session
      .operations()
      .invoke('export-uvw-native', { schemaVersion: 1, formatId: 'ra2-map' })
    expect(result).toMatchObject({
      state: 'ok',
      output: { kind: 'bytes', value: Uint8Array.of(1, 2, 3), extension: 'map' },
    })
    expect(result.diagnostics.map(item => item.code)).toContain('westwood/uvw-object-untyped')
    // the encoder gets the document as the file holds it, and only it
    expect(received).toEqual(new Uint8Array(bytes))
    expect(requests).toMatchObject([
      { contract: NATIVE_MAP_ENCODER_CONTRACT, major: 1, facet: { formatId: 'ra2-map' } },
    ])
    await session.dispose()
  })

  it("passes the encoder's catalog questions on, and its answers back", async () => {
    const seen: unknown[] = []
    const encoder = {
      contract: NATIVE_MAP_ENCODER_CONTRACT,
      formatId: 'ra2-map',
      extension: 'map',
      async encode(request: { readonly catalogEntities?: readonly unknown[] }) {
        seen.push(request.catalogEntities)
        return request.catalogEntities === undefined
          ? { formatId: 'ra2-map', catalogQueries: [{ namespace: 'vehicle', entityId: 'HTNK' }] }
          : { formatId: 'ra2-map', extension: 'map', bytes: Uint8Array.of(7) }
      },
    }
    const session = await createCodec(encoding(encoder, [])).open(
      inputFor(source(await fixture())),
      'full',
      budget,
    )
    const asked = await session
      .operations()
      .invoke('export-uvw-native', { schemaVersion: 1, formatId: 'ra2-map' })
    expect(asked).toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: { catalogQueries: [{ namespace: 'vehicle', entityId: 'HTNK' }] },
      },
    })
    const entity = { namespace: 'vehicle', entityId: 'HTNK', typeId: 'vehicle', fields: {} }
    const written = await session.operations().invoke('export-uvw-native', {
      schemaVersion: 1,
      formatId: 'ra2-map',
      catalogEntities: [entity],
    })
    expect(written).toMatchObject({ state: 'ok', output: { kind: 'bytes', extension: 'map' } })
    expect(seen).toEqual([undefined, [entity]])
    await session.dispose()
  })

  it('refuses an encoder of another format and a request without its version', async () => {
    const other = {
      contract: NATIVE_MAP_ENCODER_CONTRACT,
      formatId: 'ts-map',
      extension: 'map',
      async encode() {
        throw new Error('not reached')
      },
    }
    const session = await createCodec(encoding(other, [])).open(
      inputFor(source(await fixture())),
      'full',
      budget,
    )
    await expect(
      session.operations().invoke('export-uvw-native', { schemaVersion: 1, formatId: 'ra2-map' }),
    ).rejects.toThrow(/not a ra2-map native map encoder/u)
    await expect(
      session.operations().invoke('export-uvw-native', { formatId: 'ra2-map' }),
    ).rejects.toThrow(/schemaVersion/u)
    await session.dispose()
  })
})
