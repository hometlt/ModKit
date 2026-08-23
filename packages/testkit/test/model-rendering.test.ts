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
} from '@modkitx-x3/sdk'

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

const cameras = {
  glb: new Float32Array([1.6, 0, 0, 0, 0, 1.6, 0, 0, 0, 0, 1, 0, -0.8, -0.8, 0, 1]),
  m3: new Float32Array([1.6, 0, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 0, -0.8, -0.8, 0, 1]),
}

describe('decoded model to headless PNG vertical', () => {
  it.each([
    {
      format: 'glb',
      codec: join(repoRoot, 'extensions', 'common', 'models', 'src', 'formats', 'gltf', 'codec.js'),
      bytes: glbFixture,
      primitiveId: 'mesh-0-primitive-0',
      digest: '1410c2b514695d3d31dfa97f1854ae27ea518f91ac37c12e581a62c54e464ccf',
    },
    {
      format: 'm3',
      codec: join(repoRoot, 'extensions', 'blizzard', 'models', 'src', 'm3', 'codec.js'),
      bytes: async () => new Uint8Array(await readFile(join(fixtureRoot, 'models', 'triangle.m3'))),
      primitiveId: 'division-0-region-0',
      digest: '1410c2b514695d3d31dfa97f1854ae27ea518f91ac37c12e581a62c54e464ccf',
    },
  ] as const)('$format geometry renders to a deterministic PNG fixture', async fixture => {
    const codecModule = (await import(pathToFileURL(fixture.codec).href)) as {
      createCodec(context: ContributionContext): Codec
    }
    const { renderHeadless } = (await import(
      pathToFileURL(join(repoRoot, 'extensions', 'common', 'rendering-3d', 'src', 'headless.js'))
        .href
    )) as {
      renderHeadless(request: Record<string, unknown>): Promise<{
        width: number
        height: number
        rgba: Uint8Array
        statistics: { fragments: number }
      }>
    }
    const { encodeRgbaPng } = (await import(
      pathToFileURL(join(repoRoot, 'extensions', 'common', 'rendering-3d', 'src', 'png.js')).href
    )) as {
      encodeRgbaPng(frame: { width: number; height: number; rgba: Uint8Array }): Promise<Uint8Array>
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
      const frame = await renderHeadless({
        scene: {
          materials: [{ id: 'surface', baseColor: [0.22, 0.68, 0.94, 1] }],
          primitives: [{ ...primitive, materialId: 'surface' }],
        },
        camera: { viewProjection: cameras[fixture.format] },
        viewport: { width: 48, height: 48 },
        clearColor: [0.015, 0.02, 0.03, 1],
        outputKind: 'rgba8',
      })
      expect(frame.statistics.fragments).toBeGreaterThan(0)
      const png = await encodeRgbaPng(frame)
      expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(createHash('sha256').update(png).digest('hex')).toBe(fixture.digest)
    } finally {
      await lease.release()
      await session.dispose()
    }
  })
})
