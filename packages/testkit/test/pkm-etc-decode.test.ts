/**
 * ETC decoding for PKM (block 12 slice 12-5, exit-gate line 2b).
 *
 * `block9/decoded-gpu-texture-payloads` asked that GPU-block textures publish decoded pixels rather
 * than headers. The canonical stack does that through a third-party `texture2ddecoder` WASM
 * package — a binary dependency, so there is nothing to port — and the slice's rule for that case
 * is a clean implementation from the specification where it is liftable. ETC is where it is: the
 * block layout is small and fully documented.
 *
 * The tests below check the decode against values computed by hand from the spec, not against the
 * implementation's own output. A golden file produced by the code under test proves only that the
 * code is deterministic.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { proves } from '@modkitx-x3/testkit'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type RasterImageSource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixtures = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')

const budget: ResourceBudget = {
  maxInputBytes: 8_000_000n,
  maxDepth: 16,
  maxNodes: 4096,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 32,
}

function byteSource(bytes: Uint8Array): ArtifactByteSource {
  const uri = 'memory://pkm-etc-decode/minimal.pkm'
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:pkm-etc-decode'),
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
      compositionFingerprint: `pkm-etc-${source.ref.id}`,
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
  } as unknown as AssetInput
}

async function codec() {
  const module = (await import(
    pathToFileURL(join(repoRoot, 'extensions', 'common', 'images', 'src', 'pkm', 'codec.js')).href
  )) as { createCodec(context: unknown): { open: unknown } }
  return module.createCodec({})
}

async function decodeModule() {
  return (await import(
    pathToFileURL(join(repoRoot, 'extensions', 'common', 'images', 'src', 'pkm', 'etc.js')).href
  )) as {
    decodeEtcRgba(
      payload: Uint8Array,
      blocksWide: number,
      blocksHigh: number,
      format: string,
    ): Uint8Array | undefined
  }
}

/** An ETC1 block in individual mode: two flat 4-bit colours, all indices selecting modifier 0. */
function individualBlock(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
  table = 0,
): Uint8Array {
  return Uint8Array.from([
    (left[0] << 4) | right[0],
    (left[1] << 4) | right[1],
    (left[2] << 4) | right[2],
    (table << 5) | (table << 2), // diffbit 0, flipbit 0 → left half / right half
    0,
    0,
    0,
    0, // every index 0
  ])
}

describe('12-5 PKM publishes decoded ETC pixels', () => {
  it('decodes an individual-mode ETC1 block to the colours the spec computes', async () => {
    const { decodeEtcRgba } = await decodeModule()
    /*
     * Individual mode stores two 4-bit-per-channel colours, extended to 8 bits by replication:
     * 0xA → 0xAA, 0x3 → 0x33. Index 0 with table 0 applies modifier +2, so the left half is
     * 0xAA + 2 and the right half 0x33 + 2. Both numbers come from the specification, not from a
     * previous run of this decoder.
     */
    const decoded = decodeEtcRgba(
      individualBlock([0xa, 0xa, 0xa], [0x3, 0x3, 0x3]),
      1,
      1,
      'ETC1_RGB',
    )
    expect(decoded).toBeDefined()
    const pixels = decoded as Uint8Array
    expect([...pixels.subarray(0, 4)]).toEqual([0xaa + 2, 0xaa + 2, 0xaa + 2, 255])
    // x = 2 is the first column of the second sub-block
    expect([...pixels.subarray(2 * 4, 2 * 4 + 4)]).toEqual([0x33 + 2, 0x33 + 2, 0x33 + 2, 255])
  })

  it('clamps a modifier that would leave the channel range instead of wrapping it', async () => {
    const { decodeEtcRgba } = await decodeModule()
    /*
     * 0xF extends to 0xFF, and table 7 index 1 is +183, so the sum saturates at 255 rather than
     * wrapping to 182. Index 1 is msb 0 / lsb 1, which lives in the *low* half of the index word —
     * bytes 6 and 7. Setting bytes 4 and 5 instead selects index 2, which is -47; that is a
     * different (also correct) answer to a different question.
     */
    const block = individualBlock([0xf, 0xf, 0xf], [0xf, 0xf, 0xf], 7)
    block[6] = 0xff
    block[7] = 0xff
    const pixels = decodeEtcRgba(block, 1, 1, 'ETC1_RGB') as Uint8Array
    expect([...pixels.subarray(0, 3)]).toEqual([255, 255, 255])
  })

  it('refuses a payload shorter than the block grid it declares', async () => {
    const { decodeEtcRgba } = await decodeModule()
    expect(() => decodeEtcRgba(new Uint8Array(7), 1, 1, 'ETC1_RGB')).toThrow(/shorter than/u)
  })

  it('decodes unsigned EAC but keeps signed channels without a raster view', async () => {
    const { decodeEtcRgba } = await decodeModule()
    const unsigned = decodeEtcRgba(
      Uint8Array.from([103, 0x2d, 0x6d, 0xb6, 0xdb, 0x6d, 0xb6, 0xdb]),
      1,
      1,
      'EAC_R11',
    ) as Uint8Array
    expect([...unsigned.subarray(0, 4)]).toEqual([83, 0, 0, 255])
    expect(decodeEtcRgba(new Uint8Array(8), 1, 1, 'EAC_SIGNED_R11')).toBeUndefined()
    expect(decodeEtcRgba(new Uint8Array(16), 1, 1, 'EAC_SIGNED_RG11')).toBeUndefined()
  })

  it('opens the shipped fixture and serves its pixel through the raster contract', async () => {
    const bytes = new Uint8Array(await readFile(join(fixtures, 'minimal.pkm')))
    const instance = (await codec()) as {
      open(input: unknown, intent: string, resource: ResourceBudget): Promise<unknown>
    }
    const session = (await instance.open(inputFor(byteSource(bytes)), 'inspect', budget)) as {
      descriptor(): Promise<{ dataSources: readonly { contract: string }[] }>
      dataSource(
        contract: string,
        major: number,
      ): Promise<{ value: unknown; release(): Promise<void> }>
      dispose(): Promise<void>
    }

    const descriptor = await session.descriptor()
    expect(descriptor.dataSources.map(item => item.contract)).toContain(
      'common.view/raster-image-source',
    )
    const lease = await session.dataSource('common.view/raster-image-source', 1)
    const raster = lease.value as RasterImageSource
    const info = await raster.info()
    // the whole point of the row: pixels, not just a header
    expect(info).toMatchObject({ width: 1, height: 1, decodedAccess: true })
    if (raster.readRegion === undefined) throw new Error('the raster source published no reader')
    const region = await raster.readRegion({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pixelFormat: 'rgba8',
      maxBytes: 4096,
    })
    expect(region.pixels).toHaveLength(4)
    expect(region.pixels[3]).toBe(255)
    await lease.release()
    await session.dispose()

    proves({
      contributionId: 'org.modkitx/pkm',
      operation: 'read',
      note: 'ETC1 block decoded to rgba8 and served through readRegion',
    })
  }, 60_000)

  it('refuses to decode an image the caller has no budget for', async () => {
    /*
     * A decoded region is memory the caller did not ask for, so the ceiling is checked before the
     * decode runs rather than after it has already been allocated.
     */
    const bytes = new Uint8Array(await readFile(join(fixtures, 'minimal.pkm')))
    const instance = (await codec()) as {
      open(input: unknown, intent: string, resource: ResourceBudget): Promise<unknown>
    }
    await expect(
      instance.open(inputFor(byteSource(bytes)), 'inspect', { ...budget, maxScalarBytes: 3 }),
    ).rejects.toThrow(/scalar budget/u)
  }, 60_000)
})
