import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ModelSceneSource,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const modelRoot = join(repoRoot, 'extensions', 'mk2', 'common-models')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const formats = ['obj', 'ply', 'stl', 'dae', 'gltf', 'uvm', 'm3'] as const
type Format = (typeof formats)[number]
const fixtureNames: Record<Format, string> = {
  obj: 'minimal.obj',
  ply: 'minimal.ply',
  stl: 'minimal.stl',
  dae: 'minimal.dae',
  gltf: 'minimal.gltf',
  uvm: 'minimal.uvm.glb',
  // Generated from the canonical encodeM3RenderModel triangle; no game-owned file is vendored.
  m3: 'triangle.m3',
}
const primitiveIds: Record<Format, string> = {
  obj: 'primitive-0',
  ply: 'primitive-0',
  stl: 'primitive-0',
  dae: 'geometry-0-primitive-0',
  gltf: 'mesh-0-primitive-0',
  uvm: 'mesh-0-primitive-0',
  m3: 'division-0-region-0',
}

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('MK2 model codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('MK2 model codecs have no foreign service dependency')
    },
  },
}

function byteSource(format: Format, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://mk2-model-codecs/${fixtureNames[format]}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:mk2-model-${format}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new Error('cancelled')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(source: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
      compositionFingerprint: `mk2-model-${source.ref.id}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value: source,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function codecFor(format: Format): Promise<Codec> {
  const extensionRoot =
    format === 'm3' ? join(repoRoot, 'extensions', 'mk2', 'blizzard-models') : modelRoot
  const module = (await import(
    pathToFileURL(join(extensionRoot, 'src', format, 'codec.js')).href
  )) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function fixture(format: Format): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixtureRoot, fixtureNames[format])))
}

async function open(format: Format, bytes: Uint8Array, resourceBudget = budget) {
  const codec = await codecFor(format)
  const source = byteSource(format, bytes)
  return codec.open(inputFor(source), 'inspect', resourceBudget)
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value)

function bigEndianPly(): Uint8Array {
  const header = text(
    'ply\nformat binary_big_endian 1.0\n' +
      'element vertex 3\nproperty float x\nproperty float y\nproperty float z\n' +
      'element face 1\nproperty list uchar int vertex_indices\nend_header\n',
  )
  const body = new Uint8Array(3 * 12 + 13)
  const view = new DataView(body.buffer)
  const values = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  values.forEach((value, index) => view.setFloat32(index * 4, value, false))
  body[36] = 3
  view.setInt32(37, 0, false)
  view.setInt32(41, 1, false)
  view.setInt32(45, 2, false)
  const result = new Uint8Array(header.byteLength + body.byteLength)
  result.set(header)
  result.set(body, header.byteLength)
  return result
}

describe('ported MK2 geometry model codecs', () => {
  it.each(formats)('%s publishes bounded decoded triangle geometry', async format => {
    const session = await open(format, await fixture(format))
    const descriptor = await session.descriptor()
    expect(descriptor.traits).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'model.geometry' })]),
    )
    expect(descriptor.constraints.maxDecodedBytes).not.toBe('0')

    const lease = await session.dataSource('common.view/model-scene-source', 1)
    const model = lease.value as ModelSceneSource
    const expectedBounds =
      format === 'm3' ? { min: [0, -0, 0], max: [1, -0, 1] } : { min: [0, 0, 0], max: [1, 1, 0] }
    expect(await model.info()).toMatchObject({
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      geometryAccess: 'decoded',
      bounds: expectedBounds,
    })
    const primitiveId = primitiveIds[format]
    const primitive = await model.primitive?.(primitiveId, { maxBytes: 1024 })
    expect(primitive?.topology).toBe('triangles')
    expect(primitive?.positions).toHaveLength(9)
    expect(primitive?.indices).toEqual(new Uint32Array([0, 1, 2]))
    await expect(model.primitive?.(primitiveId, { maxBytes: 1 })).rejects.toThrow(/maxBytes/u)

    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    const root = await tree.root()
    expect((await tree.children(root, { limit: 10 })).items.length).toBeGreaterThan(0)
    await treeLease.release()
    await lease.release()
    await session.dispose()
  })

  it('decodes PLY 1.0 ASCII and big-endian records and triangulates polygons', async () => {
    const ascii = text(
      'ply\nformat ascii 1.0\nelement vertex 4\n' +
        'property float x\nproperty float y\nproperty float z\n' +
        'element face 1\nproperty list uchar int vertex_indices\nend_header\n' +
        '0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n',
    )
    const asciiSession = await open('ply', ascii)
    const asciiLease = await asciiSession.dataSource('common.view/model-scene-source', 1)
    const asciiModel = asciiLease.value as ModelSceneSource
    expect(await asciiModel.primitive?.('primitive-0', { maxBytes: 1024 })).toMatchObject({
      topology: 'triangles',
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    })
    await asciiLease.release()
    await asciiSession.dispose()

    const bigSession = await open('ply', bigEndianPly())
    const result = await bigSession.operations().invoke('inspect', null)
    expect(result).toMatchObject({
      state: 'ok',
      output: { kind: 'json', value: { encoding: 'binary_big_endian', triangles: 1 } },
    })
    await bigSession.dispose()
  })

  it('decodes strict ASCII STL facets and derives a zero-declared normal', async () => {
    const ascii = text(
      'solid triangle\n' +
        'facet normal 0 0 0\nouter loop\n' +
        'vertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\n' +
        'endloop\nendfacet\nendsolid triangle\n',
    )
    const session = await open('stl', ascii)
    const lease = await session.dataSource('common.view/model-scene-source', 1)
    const model = lease.value as ModelSceneSource
    expect((await model.primitive?.('primitive-0', { maxBytes: 1024 }))?.normals).toEqual(
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    )
    await lease.release()
    await session.dispose()
  })

  it('expands OBJ relative position/UV/normal indices while triangulating a quad', async () => {
    const obj = text(
      'o Quad\n' +
        'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n' +
        'vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n' +
        'vn 0 0 1\nf -4/-4/1 -3/-3/1 -2/-2/1 -1/-1/1\n',
    )
    const session = await open('obj', obj)
    const lease = await session.dataSource('common.view/model-scene-source', 1)
    const model = lease.value as ModelSceneSource
    const primitive = await model.primitive?.('primitive-0', { maxBytes: 2048 })
    expect(primitive?.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]))
    expect(primitive?.normals).toHaveLength(12)
    expect(primitive?.textureCoordinates).toHaveLength(8)
    await lease.release()
    await session.dispose()
  })

  it('triangulates a COLLADA polylist and expands independent normal indices', async () => {
    const dae = text(
      '<COLLADA version="1.4.1"><library_geometries><geometry id="quad"><mesh>' +
        '<source id="p"><float_array id="pa" count="12">0 0 0 1 0 0 1 1 0 0 1 0</float_array><technique_common><accessor source="#pa" count="4" stride="3"/></technique_common></source>' +
        '<source id="n"><float_array id="na" count="3">0 0 1</float_array><technique_common><accessor source="#na" count="1" stride="3"/></technique_common></source>' +
        '<vertices id="v"><input semantic="POSITION" source="#p"/></vertices>' +
        '<polylist count="1"><input semantic="VERTEX" source="#v" offset="0"/><input semantic="NORMAL" source="#n" offset="1"/><vcount>4</vcount><p>0 0 1 0 2 0 3 0</p></polylist>' +
        '</mesh></geometry></library_geometries></COLLADA>',
    )
    const session = await open('dae', dae)
    const lease = await session.dataSource('common.view/model-scene-source', 1)
    const model = lease.value as ModelSceneSource
    const primitive = await model.primitive?.('geometry-0-primitive-0', { maxBytes: 2048 })
    expect(primitive?.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]))
    expect(primitive?.normals).toHaveLength(12)
    await lease.release()
    await session.dispose()
  })

  it.each(formats)('%s rejects structural corruption', async format => {
    const bytes = await fixture(format)
    let corrupted: Uint8Array
    if (format === 'obj')
      corrupted = text(new TextDecoder().decode(bytes).replace('3/3/1', '9/3/1'))
    else if (format === 'dae')
      corrupted = text(new TextDecoder().decode(bytes).replace('<p>0 1 2</p>', '<p>0 1 9</p>'))
    else if (format === 'gltf')
      corrupted = text(new TextDecoder().decode(bytes).replace('"count": 3', '"count": 9'))
    else {
      corrupted = bytes.slice()
      if (format === 'ply')
        new DataView(corrupted.buffer).setUint32(corrupted.byteLength - 4, 9, true)
      else if (format === 'stl') new DataView(corrupted.buffer).setUint32(80, 2, true)
      else new DataView(corrupted.buffer).setUint32(8, corrupted.byteLength + 4, true)
    }
    await expect(open(format, corrupted)).rejects.toThrow(/OBJ|PLY|STL|COLLADA|glTF|UVM|M3/u)
  })

  it.each(formats)('%s enforces node and scalar budgets', async format => {
    const bytes = await fixture(format)
    await expect(open(format, bytes, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
    await expect(open(format, bytes, { ...budget, maxScalarBytes: 5 })).rejects.toThrow(
      /maxScalarBytes/u,
    )
  })
})
