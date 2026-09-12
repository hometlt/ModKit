import { createHash } from 'node:crypto'
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
} from '@modkit/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixtureRoot = join(import.meta.dirname, 'fixtures')
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('model render fixtures have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('model render fixtures have no foreign service dependency')
    },
  },
}

function inputFor(name: string, bytes: Uint8Array): AssetInput {
  const uri = `memory://model-rendering/${name}`
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:model-rendering-${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
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
      compositionFingerprint: `model-rendering-${name}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

function padded(bytes: Uint8Array, pad: number): Uint8Array {
  const length = Math.ceil(bytes.byteLength / 4) * 4
  const out = new Uint8Array(length)
  out.fill(pad)
  out.set(bytes)
  return out
}

async function glbFixture(): Promise<Uint8Array> {
  const document = JSON.parse(
    await readFile(join(fixtureRoot, 'mk2-synthetic', 'minimal.gltf'), 'utf8'),
  ) as { buffers: { byteLength: number; uri?: string }[] }
  const uri = document.buffers[0]?.uri
  if (uri === undefined) throw new Error('glTF fixture has no embedded buffer')
  const comma = uri.indexOf(',')
  if (comma < 0) throw new Error('glTF fixture buffer URI is invalid')
  const binary = padded(Uint8Array.from(Buffer.from(uri.slice(comma + 1), 'base64')), 0)
  delete document.buffers[0]?.uri
  const json = padded(new TextEncoder().encode(JSON.stringify(document)), 0x20)
  const out = new Uint8Array(12 + 8 + json.byteLength + 8 + binary.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.byteLength, true)
  view.setUint32(12, json.byteLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(json, 20)
  const binaryHeader = 20 + json.byteLength
  view.setUint32(binaryHeader, binary.byteLength, true)
  view.setUint32(binaryHeader + 4, 0x004e4942, true)
  out.set(binary, binaryHeader + 8)
  return out
}

function glbChunk(bytes: Uint8Array, type: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 12; offset < bytes.byteLength;) {
    const length = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    if (chunkType === type) return bytes.slice(offset + 8, offset + 8 + length)
    offset += 8 + length
  }
  throw new Error(`missing GLB chunk ${type.toString(16)}`)
}

function editedBytes(result: unknown): Uint8Array {
  const output = result as {
    state?: string
    output?: {
      kind?: string
      plan?: {
        edits?: readonly {
          operation?: string
          payload?: { kind?: string; bytes?: Uint8Array }
        }[]
      }
    }
  }
  const edit = output.output?.plan?.edits?.[0]
  if (
    output.state !== 'ok' ||
    output.output?.kind !== 'edit-plan' ||
    edit?.operation !== 'replace' ||
    edit.payload?.kind !== 'inline' ||
    edit.payload.bytes === undefined
  )
    throw new Error('glTF edit did not produce an inline replacement')
  return edit.payload.bytes
}

const cameras = {
  gltf: new Float32Array([1.6, 0, 0, 0, 0, 1.6, 0, 0, 0, 0, 1, 0, -0.8, -0.8, 0, 1]),
  glb: new Float32Array([1.6, 0, 0, 0, 0, 1.6, 0, 0, 0, 0, 1, 0, -0.8, -0.8, 0, 1]),
}

const clearColor = [0.015, 0.02, 0.03, 0] as const

describe('decoded model to headless PNG vertical', () => {
  it.each([
    {
      format: 'gltf',
      codec: join(repoRoot, 'extensions', 'models', 'src', 'gltf', 'codec.js'),
      bytes: async () =>
        new Uint8Array(await readFile(join(fixtureRoot, 'mk2-synthetic', 'minimal.gltf'))),
      primitiveId: 'mesh-0-primitive-0',
      digest: '285511d65da8ee40c3d98cecca3b1184b58997fa1b385dc129db428b0eeb4949',
    },
    {
      format: 'glb',
      codec: join(repoRoot, 'extensions', 'models', 'src', 'gltf', 'codec.js'),
      bytes: glbFixture,
      primitiveId: 'mesh-0-primitive-0',
      digest: '285511d65da8ee40c3d98cecca3b1184b58997fa1b385dc129db428b0eeb4949',
    },
  ] as const)(
    '$format geometry renders to a deterministic PNG fixture',
    async fixture => {
      const codecModule = (await import(pathToFileURL(fixture.codec).href)) as {
        createCodec(context: ContributionContext): Codec
      }
      const { renderHeadless } = (await import(
        pathToFileURL(join(repoRoot, 'packages', 'scene', 'src', 'render', 'headless.js')).href
      )) as {
        renderHeadless(request: Record<string, unknown>): Promise<{
          width: number
          height: number
          rgba: Uint8Array
          statistics: { fragments: number }
        }>
      }
      const { encodeRgbaPng } = (await import(
        pathToFileURL(join(repoRoot, 'packages', 'scene', 'src', 'output', 'png.js')).href
      )) as {
        encodeRgbaPng(frame: {
          width: number
          height: number
          rgba: Uint8Array
        }): Promise<Uint8Array>
      }
      const bytes = await fixture.bytes()
      const session = await codecModule
        .createCodec(context)
        .open(inputFor(`triangle.${fixture.format}`, bytes), 'inspect', budget)
      const lease = await session.dataSource('common.view/model-scene-source', 1)
      try {
        const source = lease.value as ModelSceneSource
        expect(await source.info()).toMatchObject({ geometryAccess: 'decoded', primitives: 1 })
        const primitive = await source.primitive?.(fixture.primitiveId, { maxBytes: 1_000_000 })
        if (primitive === undefined) throw new Error(`${fixture.format} returned no geometry`)
        const request = {
          scene: {
            materials: [{ id: 'surface', baseColor: [0.22, 0.68, 0.94, 1] }],
            primitives: [{ ...primitive, materialId: 'surface' }],
          },
          camera: { viewProjection: cameras[fixture.format] },
          viewport: { width: 48, height: 48 },
          clearColor,
          outputKind: 'rgba8',
        }
        const frame = await renderHeadless(request)
        expect(frame).toMatchObject({ width: 48, height: 48 })
        expect(frame.statistics.fragments).toBeGreaterThan(0)
        let coveredPixels = 0
        for (let offset = 3; offset < frame.rgba.length; offset += 4) {
          if (frame.rgba[offset] !== 0) coveredPixels += 1
        }
        expect(coveredPixels).toBeGreaterThan(0)
        const png = await encodeRgbaPng(frame)
        const repeated = await encodeRgbaPng(await renderHeadless(request))
        expect(repeated).toEqual(png)
        expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
        const emptyRgba = new Uint8Array(48 * 48 * 4)
        for (let offset = 0; offset < emptyRgba.length; offset += 4) {
          emptyRgba.set([4, 5, 8, 0], offset)
        }
        const emptyPng = await encodeRgbaPng({ width: 48, height: 48, rgba: emptyRgba })
        expect(png).not.toEqual(emptyPng)
        expect(createHash('sha256').update(png).digest('hex')).toBe(fixture.digest)
      } finally {
        await lease.release()
        await session.dispose()
      }
    },
    15_000,
  )
})

describe('native glTF document tree and edits', () => {
  it.each([
    {
      format: 'gltf',
      bytes: async () =>
        new Uint8Array(await readFile(join(fixtureRoot, 'mk2-synthetic', 'minimal.gltf'))),
    },
    { format: 'glb', bytes: glbFixture },
  ] as const)('$format exposes and edits the complete native document', async fixture => {
    const codecModule = (await import(
      pathToFileURL(join(repoRoot, 'extensions', 'models', 'src', 'gltf', 'codec.js')).href
    )) as { createCodec(context: ContributionContext): Codec }
    const original = await fixture.bytes()
    const session = await codecModule
      .createCodec(context)
      .open(inputFor(`native.${fixture.format}`, original), 'inspect', budget)
    const lease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    const facts = await tree.facts({ id: 'json:/nodes/0/name', hasChildren: false })
    expect(facts).toMatchObject({
      value: 'Triangle',
      semanticPath: ['nodes', '0', 'name'],
      editable: { write: { operation: 'edit.field' } },
    })
    const changed = editedBytes(
      await session.operations().invoke('set-gltf-field', {
        groupId: 'tree',
        key: 'name',
        path: [...(facts.semanticPath ?? [])],
        value: 'Edited triangle',
      }),
    )
    if (fixture.format === 'glb')
      expect(glbChunk(changed, 0x004e4942)).toEqual(glbChunk(original, 0x004e4942))
    await lease.release()
    await session.dispose()

    const reopened = await codecModule
      .createCodec(context)
      .open(inputFor(`edited.${fixture.format}`, changed), 'inspect', budget)
    const reopenedLease = await reopened.dataSource('common.view/tree-data-source', 1)
    expect(
      await (reopenedLease.value as TreeDataSource).facts({
        id: 'json:/nodes/0/name',
        hasChildren: false,
      }),
    ).toMatchObject({ value: 'Edited triangle' })
    await reopenedLease.release()
    await reopened.dispose()
  })
})
