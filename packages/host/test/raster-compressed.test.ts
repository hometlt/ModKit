import { join } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
} from '../src/index.js'
import { loadExtensionDirectory } from '../src/node/index.js'
import { createSubjectRasterResources } from '../src/raster-resources.js'

const root = join(import.meta.dirname, '../../..')
const budget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 10000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'raster-compressed', classes: ['read-source'] } as const
const backends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: (await import(context.entrypoint.href)) as Record<string, unknown>,
        release: async () => undefined,
      }
    },
  },
])
let inventory: Awaited<ReturnType<typeof buildInventory>>
beforeAll(async () => {
  inventory = await buildInventory(
    [
      {
        ...(await loadExtensionDirectory(join(root, 'extensions/images'))),
        execution: { origin: 'bundled', allowTrustedInProcess: true },
      },
    ],
    createHostContributionContractRegistry(),
  )
})

/** A DDS of one DXT1 block per level (8x8, four stored levels), each level its own block value. */
function dxt1Chain(): { bytes: Uint8Array; levels: Uint8Array[] } {
  const sizes = [8, 4, 2, 1]
  const levels = sizes.map((size, level) => {
    const blocks = Math.ceil(size / 4) ** 2
    const data = new Uint8Array(blocks * 8)
    const view = new DataView(data.buffer)
    for (let block = 0; block < blocks; block++) {
      view.setUint16(block * 8, 0xf800 >> level, true)
      view.setUint16(block * 8 + 2, 0x001f << level, true)
      view.setUint32(block * 8 + 4, 0x1b1b1b1b + block, true)
    }
    return data
  })
  const payload = levels.reduce((total, level) => total + level.byteLength, 0)
  const bytes = new Uint8Array(128 + payload)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x2053_4444, true)
  view.setUint32(4, 124, true)
  view.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x2_0000, true)
  view.setUint32(12, 8, true)
  view.setUint32(16, 8, true)
  view.setUint32(24, 1, true)
  view.setUint32(28, sizes.length, true)
  view.setUint32(76, 32, true)
  view.setUint32(80, 0x4, true)
  for (const [index, char] of [...'DXT1'].entries()) view.setUint8(84 + index, char.charCodeAt(0))
  view.setUint32(108, 0x1000 | 0x40_0000, true)
  let offset = 128
  for (const level of levels) {
    bytes.set(level, offset)
    offset += level.byteLength
  }
  return { bytes, levels }
}

function port() {
  const state = { live: true, authorized: true, reservedBytes: 0 }
  return {
    state,
    port: createSubjectRasterResources({
      state,
      budget,
      isAuthorized: () => state.authorized,
      open: (source, hint) =>
        openSubject({
          inventory,
          executionBackends: backends,
          source,
          ...hint,
          target,
          grant,
          budget,
          intent: 'full',
        }),
    }),
  }
}

it('hands a named block format over as its stored levels, owned by the caller', async () => {
  const { bytes, levels } = dxt1Chain()
  const { port: raster, state } = port()
  const result = await raster.read({
    kind: 'embedded',
    bytes,
    mediaType: 'image/vnd-ms.dds',
    maxBytes: 56,
    selection: { mipLevel: 'fit' },
    compressedFormats: ['bc1-rgba-unorm'],
  })
  if (result.state !== 'compressed') throw new Error(JSON.stringify(result))
  expect(result.subresource).toEqual({ frame: 0, mipLevel: 0, layer: 0, face: 0, slice: 0 })
  expect(result.texture).toMatchObject({
    format: 'bc1-rgba-unorm',
    dimensions: { width: 8, height: 8, depth: 1 },
    mipLevelCount: 4,
    layerCount: 1,
    faceCount: 1,
    block: { width: 4, height: 4, depth: 1, bytes: 8 },
  })
  for (const [index, level] of result.texture.subresources.entries()) {
    expect(level).toMatchObject({
      mipLevel: index,
      width: 8 >> index || 1,
      height: 8 >> index || 1,
    })
    expect(level.data).toEqual(levels[index])
    expect(level.data.byteLength).toBe(level.data.buffer.byteLength)
  }
  bytes.fill(0)
  expect(result.texture.subresources[0]?.data).toEqual(levels[0])
  expect(state.reservedBytes).toBe(0)
})

it('fits the budget by block bytes: the level and every smaller one', async () => {
  const { bytes, levels } = dxt1Chain()
  // 4x4 + 2x2 + 1x1 are three blocks; the whole chain (seven) is over the budget.
  const result = await port().port.read({
    kind: 'embedded',
    bytes,
    mediaType: 'image/vnd-ms.dds',
    maxBytes: 24,
    selection: { mipLevel: 'fit' },
    compressedFormats: ['bc1-rgba-unorm'],
  })
  if (result.state !== 'compressed') throw new Error(JSON.stringify(result))
  expect(result.subresource.mipLevel).toBe(1)
  expect(result.texture.dimensions).toEqual({ width: 4, height: 4, depth: 1 })
  expect(result.texture.subresources.map(level => level.mipLevel)).toEqual([0, 1, 2])
  expect(result.texture.subresources.map(level => level.data)).toEqual(levels.slice(1))
})

it('decodes an image whose format the caller did not name, as before', async () => {
  const { bytes } = dxt1Chain()
  const result = await port().port.read({
    kind: 'embedded',
    bytes,
    mediaType: 'image/vnd-ms.dds',
    maxBytes: 8 * 8 * 4,
    compressedFormats: ['bc3-rgba-unorm'],
  })
  expect(result.state).toBe('decoded')
})
