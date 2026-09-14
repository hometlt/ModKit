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
