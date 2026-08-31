/**
 * The UVT/core materializer (block 12, slice 12-1).
 *
 * Block 11 raised the UVT profile from a stub to a conversion-grade schema with fixtures and a
 * validator, and said in as many words that no materializer existed. This is the materializer, and
 * this file is what makes the claim checkable rather than announced.
 *
 * Three separate oracles, none of them the module under test:
 *
 *  - the pinned `assertUvtProfile` from `multiverse/specs` accepts the sidecar's cross-field rules;
 *  - a second KTX 2.0 reader in the testkit re-reads the container, and every row of SPEC_UVT §1's
 *    mandatory mapping table is compared against what that reader saw — a sidecar that disagrees
 *    with its container is a defect by the profile's own words;
 *  - the pinned `texture-interchange-v1` candidate scope hashes the live projection and the one
 *    rebuilt from the reopened container, and the two must be the same digit for digit.
 *
 * The inputs are real: BMP and TGA are opened through their shipped codecs and their decoded
 * regions are what gets materialized. Two independent raster families rather than one synthetic
 * buffer, because a converter proved against a buffer it authored itself is proved against nothing.
 */
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
  type RasterImageSource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { materializeTextureAndCompare, readKtx2Container } from '@modkitx-x3/testkit'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const syntheticDir = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 32,
  maxNodes: 100_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('image fixtures have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('image fixtures have no foreign service dependency')
    },
  },
}

function inputFor(name: string, bytes: Uint8Array): AssetInput {
  const uri = `memory://uvt/${name}`
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:uvt-${name}`),
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
      compositionFingerprint: `uvt-${name}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  } as unknown as AssetInput
}

/** Open a shipped image codec and drain its whole base level as one rgba8 region. */
async function decodedImage(
  codecPath: string,
  fixture: string,
  name: string,
): Promise<{
  info: Record<string, unknown>
  region: {
    width: number
    height: number
    rowStride: number
    pixelFormat: string
    pixels: Uint8Array
  }
  dispose(): Promise<void>
}> {
  const module = (await import(pathToFileURL(join(repoRoot, codecPath)).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  const bytes = new Uint8Array(await readFile(fixture))
  const session = await module.createCodec(context).open(inputFor(name, bytes), 'inspect', budget)
  const lease = await session.dataSource('common.view/raster-image-source', 1)
  const raster = lease.value as RasterImageSource
  const info = (await raster.info()) as unknown as Record<string, unknown>
  if (raster.readRegion === undefined) throw new Error(`${name} publishes no decoded region`)
  const region = await raster.readRegion({
    x: 0,
    y: 0,
    width: info['width'] as number,
    height: info['height'] as number,
    pixelFormat: 'rgba8',
    maxBytes: 8_000_000,
  })
  return {
    info,
    region: region as unknown as {
      width: number
      height: number
      rowStride: number
      pixelFormat: string
      pixels: Uint8Array
    },
    async dispose() {
      await lease.release()
      await session.dispose()
    },
  }
}

const FAMILIES = [
  {
    format: 'bmp',
    codec: 'extensions/images/src/bmp/codec.js',
    fixture: join(syntheticDir, 'minimal.bmp'),
  },
  {
    format: 'tga',
    codec: 'extensions/images/src/tga/codec.js',
    fixture: join(syntheticDir, 'minimal.tga'),
  },
] as const

describe('a decoded raster region materialises into a conforming UVT projection', () => {
  it.each(FAMILIES)(
    '$format: the sidecar agrees with its container and the two paths hash the same',
    async family => {
      const image = await decodedImage(family.codec, family.fixture, family.format)
      try {
        const verdict = await materializeTextureAndCompare(repoRoot, image, {
          assetId: `synthetic/${family.format}`,
          subjectRevision: `content-hash.sha256:uvt-${family.format}`,
        })
        // repeat materialization is byte-identical: the container has no timestamp and no
        // iteration-order-dependent section
        expect(verdict.byteStable).toBe(true)
        // SPEC_UVT §1: a sidecar that contradicts its container is a defect, not a preference
        expect(verdict.mappingViolations).toEqual([])
        // the live projection and the reopened one are the same semantics, exactly
        expect(verdict.exact).toBe(true)
        expect(verdict.liveHash).toMatch(/^sha256:[0-9a-f]{64}$/u)

        expect(verdict.sidecar.uv).toEqual({ format: 'UVT', version: '1.0', profile: 'core' })
        expect(verdict.container.pixelWidth).toBe(image.info['width'])
        expect(verdict.container.pixelHeight).toBe(image.info['height'])
        // both fixtures declare an sRGB source, so the container carries the sRGB Vulkan format
        expect(verdict.container.vkFormat).toBe(43)
        expect(verdict.container.transferFunction).toBe('srgb')
        expect(verdict.container.primaries).toBe('bt709')
        expect(verdict.container.keyValues['KTXorientation']).toBe('rd')
        expect(verdict.container.keyValues['KTXwriter']).toContain('uvt-materializer')
        // the pixels reached the container: one level, four bytes per pixel, nothing dropped
        expect(verdict.container.levelBytes.byteLength).toBe(
          (image.info['width'] as number) * (image.info['height'] as number) * 4,
        )
        expect(verdict.receipt.scope).toEqual({
          scopeId: 'texture-interchange-v1',
          version: '1.0.0',
        })
        expect(verdict.receipt.profile).toBe('UVT/core@1.0')
        expect(verdict.receipt.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
        // an atlas nobody published is excluded rather than written empty
        expect(verdict.receipt.excludedFacetIds).toContain('uv.texture/atlas@1')
        // the sampler the profile requires was supplied, and the receipt says so rather than
        // letting a default look like a fact the source stated
        expect(verdict.receipt.diff.map(entry => entry.facetId)).toContain('uv.texture/sampler@1')
        console.info(
          `[uvt] ${family.format}: ${verdict.container.pixelWidth}x${verdict.container.pixelHeight}, ` +
            `${verdict.bytes.byteLength} bytes, digest ${verdict.artifactDigest.slice(0, 23)}…, ` +
            `receipt entries ${verdict.receipt.diff.length}, losses ${verdict.losses.length}`,
        )
      } finally {
        await image.dispose()
      }
    },
  )

  it('separates the semantic hash from the picture: one changed pixel moves only the digest', async () => {
    /*
     * The scope hashes what a runtime needs in order to *bind* a texture correctly, not the picture
     * inside it. Repainting a pixel must therefore move the container's `artifactCanonicalDigest`
     * and leave `projectionSemanticHash` alone — and if that ever inverted, one of the two values
     * would be standing in for the other, which is exactly the confusion §2.6 separates them to
     * prevent.
     */
    const width = 8
    const height = 6
    const pixels = new Uint8Array(width * height * 4)
    for (let index = 0; index < pixels.length; index += 4) {
      pixels.set([index % 251, (index * 7) % 253, (index * 13) % 241, 255], index)
    }
    const source = {
      info: {
        width,
        height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: 4,
        bitDepth: 8,
        colorSpace: 'srgb',
        alphaMode: 'straight',
        orientation: 'top-left',
        decodedAccess: true,
      },
      region: { width, height, rowStride: width * 4, pixelFormat: 'rgba8', pixels },
    }
    const repainted = {
      ...source,
      region: {
        ...source.region,
        pixels: Uint8Array.from(pixels, (value, index) => (index === 17 ? value ^ 0xff : value)),
      },
    }
    const left = await materializeTextureAndCompare(repoRoot, source, {
      assetId: 'gradient',
      subjectRevision: 'content-hash.sha256:gradient',
    })
    const right = await materializeTextureAndCompare(repoRoot, repainted, {
      assetId: 'gradient',
      subjectRevision: 'content-hash.sha256:gradient-repainted',
    })
    expect(left.bytes.byteLength).toBe(right.bytes.byteLength)
    expect(Buffer.compare(Buffer.from(left.bytes), Buffer.from(right.bytes))).not.toBe(0)
    expect(left.artifactDigest).not.toBe(right.artifactDigest)
    expect(left.liveHash).toBe(right.liveHash)
    expect(left.mappingViolations).toEqual([])
    expect(right.exact).toBe(true)
    // and the pixels really are in the container, byte for byte, in row-major order
    expect([...right.container.levelBytes]).toEqual([...repainted.region.pixels])
  })
})

describe('the materializer refuses rather than guesses', () => {
  const base = {
    width: 2,
    height: 2,
    depth: 1,
    layers: 1,
    faces: 1,
    mipLevels: 1,
    frames: 1,
    channels: 4,
    bitDepth: 8,
    colorSpace: 'srgb',
    alphaMode: 'none',
    orientation: 'top-left',
    decodedAccess: true,
  }
  const region = {
    width: 2,
    height: 2,
    rowStride: 8,
    pixelFormat: 'rgba8',
    pixels: new Uint8Array(16).fill(200),
  }
  const request = {
    scope: { scopeId: 'texture-interchange-v1', version: '1.0.0' },
    profile: 'UVT/core@1.0',
    subjectRevision: 'content-hash.sha256:refusal',
  }

  const materialize = async (source: unknown): Promise<unknown> => {
    const module = (await import(
      pathToFileURL(join(repoRoot, 'packages', 'uv', 'src', 'texture', 'materializer.js')).href
    )) as { materializeUvtCore(source: unknown, request: unknown): unknown }
    return module.materializeUvtCore(source, request)
  }

  it.each([
    { member: 'colorSpace', info: { ...base, colorSpace: 'unknown' }, message: /linear and srgb/u },
    {
      member: 'alphaMode',
      info: { ...base, alphaMode: 'unknown' },
      message: /opaque, straight and premultiplied/u,
    },
    {
      member: 'orientation',
      info: { ...base, orientation: 'unknown' },
      message: /rd or ru/u,
    },
  ])('refuses a source whose $member is unknown', async entry => {
    // each of the three changes the meaning of every pixel; the profile admits no unknown sentinel
    // and defaulting one here would silently produce a different picture
    await expect(materialize({ info: entry.info, region })).rejects.toThrow(entry.message)
  })

  it('refuses a region that is not the whole base level, or is not rgba8', async () => {
    await expect(
      materialize({ info: base, region: { ...region, width: 1, rowStride: 4 } }),
    ).rejects.toThrow(/a crop would be a different texture/u)
    await expect(
      materialize({ info: base, region: { ...region, pixelFormat: 'bgra8' } }),
    ).rejects.toThrow(/ask readRegion for rgba8/u)
  })

  it('records mip levels, layers and faces it could not carry instead of dropping them', async () => {
    const result = (await materialize({
      info: { ...base, mipLevels: 4, layers: 3, faces: 6 },
      region,
    })) as {
      losses: readonly string[]
      receipt: { diff: readonly { facetId: string; path?: string }[] }
    }
    expect(result.losses).toEqual([
      '3 mip level(s) were not carried',
      '2 array layer(s) were not carried',
      '5 cube face(s) were not carried',
    ])
    expect(result.receipt.diff.map(entry => entry.path)).toEqual(
      expect.arrayContaining(['/levelCount', '/layerCount', '/faceCount']),
    )
  })

  it('carries a premultiplied source as premultiplied in both the container and the sidecar', async () => {
    const result = (await materialize({
      info: { ...base, alphaMode: 'premultiplied', colorSpace: 'linear' },
      region,
    })) as { bytes: Uint8Array; sidecar: { color: { premultipliedAlpha: boolean } } }
    const container = readKtx2Container(result.bytes)
    expect(result.sidecar.color.premultipliedAlpha).toBe(true)
    // the flag lives in the Data Format Descriptor, and the sidecar copies it rather than asserting
    expect(container.premultipliedAlpha).toBe(true)
    // a linear source states unspecified primaries instead of asserting the common case
    expect(container.transferFunction).toBe('linear')
    expect(container.primaries).toBe('unspecified')
    expect(container.vkFormat).toBe(37)
  })
})
