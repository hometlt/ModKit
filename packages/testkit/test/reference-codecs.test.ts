import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateRawSync, deflateSync } from 'node:zlib'
import { build } from 'esbuild'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { InspectionCodecDefinition } from '../../../extensions/codec-kit/codec-kit/src/index.js'
import {
  A1_SPEC_SCHEMA_ENTRIES,
  createSpecSchemaRegistry,
  revisionId,
  validateContributionManifest,
  type ArtifactByteSource,
  type AudioMediaSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ContributionManifestV1Wire,
  type NamespaceEntrySource,
  type ModelSceneSource,
  type RasterImageSource,
  type RelationGraphSource,
  type ResourceBudget,
  type SubjectFactsSource,
  type TextDataSource,
  type TransportSource,
  type TreeDataSource,
  type VectorSceneSource,
  type VideoMediaSource,
} from '@modkitx-x3/sdk'
import { loadSubjectCardSections } from '@modkitx-x3/ui'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const codecRoots = Object.freeze({
  zip: join(repoRoot, 'extensions', 'common', 'archives'),
  mp3: join(repoRoot, 'extensions', 'common', 'audio'),
  ogg: join(repoRoot, 'extensions', 'common', 'audio'),
  png: join(repoRoot, 'extensions', 'common', 'images'),
  jpeg: join(repoRoot, 'extensions', 'common', 'images'),
  svg: join(repoRoot, 'extensions', 'common', 'vector'),
  obj: join(repoRoot, 'extensions', 'common', 'models'),
  gltf: join(repoRoot, 'extensions', 'common', 'models'),
  mp4: join(repoRoot, 'extensions', 'common', 'video'),
  webm: join(repoRoot, 'extensions', 'common', 'video'),
  markdown: join(repoRoot, 'extensions', 'common', 'documents'),
  rtf: join(repoRoot, 'extensions', 'common', 'documents'),
})

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

function u16(value: number): Uint8Array {
  const result = new Uint8Array(2)
  new DataView(result.buffer).setUint16(0, value, true)
  return result
}

function u32(value: number): Uint8Array {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, true)
  return result
}

function be32(value: number): Uint8Array {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, false)
  return result
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function zipEntry(path: string, contents: string, method: 0 | 8 = 0): Uint8Array {
  const name = new TextEncoder().encode(path)
  const data = new TextEncoder().encode(contents)
  const compressed = method === 8 ? new Uint8Array(deflateRawSync(data)) : data
  const local = concat(
    u32(0x04034b50),
    u16(20),
    u16(0x0800),
    u16(method),
    u16(0),
    u16(0),
    u32(0),
    u32(compressed.byteLength),
    u32(data.byteLength),
    u16(name.byteLength),
    u16(0),
    name,
    compressed,
  )
  const central = concat(
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0x0800),
    u16(method),
    u16(0),
    u16(0),
    u32(0),
    u32(compressed.byteLength),
    u32(data.byteLength),
    u16(name.byteLength),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    name,
  )
  const eocd = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(central.byteLength),
    u32(local.byteLength),
    u16(0),
  )
  return concat(local, central, eocd)
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const payload = concat(new TextEncoder().encode(type), data)
  let crc = 0xffffffff
  for (const value of payload) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return concat(be32(data.byteLength), payload, be32((crc ^ 0xffffffff) >>> 0))
}

function minimalPng(): Uint8Array {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, 2, false)
  view.setUint32(4, 3, false)
  ihdr[8] = 8
  ihdr[9] = 6
  const rgbaRows = new Uint8Array([
    0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 255, 0, 0, 255, 255, 255,
    255, 255, 255, 255,
  ])
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', new Uint8Array(deflateSync(rgbaRows))),
    pngChunk('IEND', new Uint8Array()),
  )
}

function minimalOggOpus(): Uint8Array {
  const header = new Uint8Array(28)
  header.set(new TextEncoder().encode('OggS'), 0)
  header[4] = 0
  header[5] = 2
  const view = new DataView(header.buffer)
  view.setBigUint64(6, 96_000n, true)
  view.setUint32(14, 7, true)
  view.setUint32(18, 0, true)
  header[26] = 1
  header[27] = 19
  const opus = new Uint8Array(19)
  opus.set(new TextEncoder().encode('OpusHead'), 0)
  opus[8] = 1
  opus[9] = 2
  new DataView(opus.buffer).setUint32(12, 48_000, true)
  return concat(header, opus)
}

function minimalJpeg(): Uint8Array {
  const frame = new Uint8Array([8, 0, 3, 0, 2, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0])
  return concat(
    new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17]),
    frame,
    new Uint8Array([0xff, 0xd9]),
  )
}

function mp4Box(type: string, ...payload: readonly Uint8Array[]): Uint8Array {
  const data = concat(...payload)
  return concat(be32(data.byteLength + 8), new TextEncoder().encode(type), data)
}

function minimalMp4(): Uint8Array {
  const mvhd = new Uint8Array(20)
  const movie = new DataView(mvhd.buffer)
  movie.setUint32(12, 1000, false)
  movie.setUint32(16, 2000, false)
  const tkhd = new Uint8Array(84)
  const trackHeader = new DataView(tkhd.buffer)
  trackHeader.setUint32(76, 320 * 65536, false)
  trackHeader.setUint32(80, 180 * 65536, false)
  const hdlr = new Uint8Array(12)
  hdlr.set(new TextEncoder().encode('vide'), 8)
  const stsd = new Uint8Array(16)
  const sample = new DataView(stsd.buffer)
  sample.setUint32(4, 1, false)
  sample.setUint32(8, 8, false)
  stsd.set(new TextEncoder().encode('avc1'), 12)
  const sampleTable = mp4Box('stbl', mp4Box('stsd', stsd))
  const media = mp4Box('mdia', mp4Box('hdlr', hdlr), mp4Box('minf', sampleTable))
  const track = mp4Box('trak', mp4Box('tkhd', tkhd), media)
  return concat(
    mp4Box('ftyp', new TextEncoder().encode('isom'), be32(0)),
    mp4Box('moov', mp4Box('mvhd', mvhd), track),
  )
}

const samples = Object.freeze({
  zip: zipEntry('hello.txt', 'hello zip'),
  mp3: concat(new Uint8Array([0xff, 0xfb, 0x90, 0x64]), new Uint8Array(2048)),
  ogg: minimalOggOpus(),
  png: minimalPng(),
  jpeg: minimalJpeg(),
  svg: new TextEncoder().encode(
    '<svg width="16" height="8" viewBox="0 0 16 8"><defs><linearGradient id="g"/></defs><path d="M0 0L16 8"/><text>MK3</text></svg>',
  ),
  obj: new TextEncoder().encode(
    'o Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n',
  ),
  gltf: new TextEncoder().encode(
    JSON.stringify({
      asset: { version: '2.0', generator: 'MK3 fixture' },
      scenes: [{ name: 'Scene', nodes: [0] }],
      nodes: [{ name: 'Triangle', mesh: 0 }],
      meshes: [{ name: 'Mesh', primitives: [{ attributes: { POSITION: 0 } }] }],
      materials: [{ name: 'Material' }],
      buffers: [{ byteLength: 36, uri: 'triangle.bin' }],
    }),
  ),
  mp4: minimalMp4(),
  webm: concat(
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
    new TextEncoder().encode('webm V_VP9 A_OPUS'),
  ),
  markdown: new TextEncoder().encode(
    '# Modkit\n\n## Codecs\n\n- ZIP\n- PNG\n\n[spec](https://example.invalid/spec)\n',
  ),
  rtf: new TextEncoder().encode(
    '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\sectd\\outlinelevel0 Codec report\\par Ready\\par}',
  ),
})

const entrypoints = Object.freeze({
  zip: 'src/formats/zip/codec.js',
  mp3: 'src/formats/mp3/codec.js',
  ogg: 'src/formats/ogg/codec.js',
  png: 'src/formats/png/codec.js',
  jpeg: 'src/formats/jpeg/codec.js',
  svg: 'src/formats/svg/codec.js',
  obj: 'src/formats/obj/codec.js',
  gltf: 'src/formats/gltf/codec.js',
  mp4: 'src/formats/mp4/codec.js',
  webm: 'src/formats/webm/codec.js',
  markdown: 'src/formats/markdown/codec.js',
  rtf: 'src/formats/rtf/codec.js',
})

type Format = keyof typeof codecRoots

function byteSource(format: Format, bytes: Uint8Array = samples[format]): ArtifactByteSource {
  const uri = `memory://reference-codecs/sample.${format === 'markdown' ? 'md' : format}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:reference-${format}`),
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
      compositionFingerprint: `reference-${source.ref.id}`,
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

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('reference inspection codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('reference inspection codecs have no foreign service dependency')
    },
  },
}

async function codecFor(format: Format): Promise<Codec> {
  const module = (await import(
    pathToFileURL(join(codecRoots[format], entrypoints[format])).href
  )) as { createCodec(context: ContributionContext): Codec }
  return module.createCodec(context)
}

async function open(format: Format) {
  const codec = await codecFor(format)
  const source = byteSource(format)
  return codec.open(inputFor(source), 'inspect', budget)
}

describe('reference codec specification stress suite', () => {
  it('validates twelve isolated codec contribution manifests', async () => {
    expectTypeOf<InspectionCodecDefinition>().toBeObject()
    const registry = createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES)
    for (const format of Object.keys(codecRoots) as Format[]) {
      const manifest = JSON.parse(
        await readFile(join(codecRoots[format], 'contributions', `codec-${format}.json`), 'utf8'),
      ) as ContributionManifestV1Wire
      const result = await validateContributionManifest(manifest, registry)
      expect(result.specState, `${format}: ${JSON.stringify(result.diagnostics)}`).toBe('validated')
      expect(manifest.runtimeVariants, `${format}: disjoint execution variants`).toEqual([
        expect.objectContaining({
          variantId: 'trusted-node',
          executionProfile: 'trusted-in-process',
          target: { environments: ['node'] },
        }),
        expect.objectContaining({
          variantId: 'portable',
          executionProfile: 'worker-brokered',
          target: { environments: ['browser-worker', 'node-worker'] },
        }),
      ])
      await expect(readFile(join(codecRoots[format], entrypoints[format]))).resolves.toBeInstanceOf(
        Buffer,
      )
    }
  })

  it.each(Object.keys(codecRoots) as Format[])('probes and opens the %s codec', async format => {
    const codec = await codecFor(format)
    const source = byteSource(format)
    const detection = await codec.probe({
      source,
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 8192 }], maxBytes: 8192 },
    })
    expect(detection.confidence, format).toBeGreaterThan(0.7)
    const session = await codec.open(inputFor(source), 'inspect', budget)
    const descriptor = await session.descriptor()
    expect(descriptor).toMatchObject({ interpretation: 'codec', identity: { formatId: format } })
    if (descriptor.interpretation !== 'codec')
      throw new TypeError('inspection codec descriptor expected')
    expect(descriptor.metadata.length, `${format} metadata`).toBeGreaterThan(0)
    for (const trait of descriptor.traits) {
      const parameters = trait.parameters
      expect(
        typeof parameters === 'object' && parameters !== null && !Array.isArray(parameters)
          ? Object.keys(parameters).length
          : 0,
        `${format}:${trait.id} parameters`,
      ).toBeGreaterThan(0)
    }
    expect(descriptor.identity.detection[0]).toMatchObject({
      kind: detection.evidence[0]?.kind,
      weight: detection.confidence,
      note: detection.evidence[0]?.note,
    })
    expect(descriptor.identity.detection[0]?.note).not.toBe('opened-and-validated')
    expect(descriptor.traits.length).toBeGreaterThan(1)
    expect(await session.operations().invoke('inspect', null)).toMatchObject({
      state: 'ok',
      output: { kind: 'json' },
    })
    expect(await session.operations().invoke('validate', null)).toMatchObject({ state: 'ok' })
    await session.dispose()
  })

  it('lists and extracts ZIP entries without importing another codec', async () => {
    const session = await open('zip')
    const namespace = await session.dataSource('common.view/namespace-entry-source', 1)
    const page = await (namespace.value as NamespaceEntrySource).list('', { limit: 10 })
    expect(page.items).toMatchObject([{ path: 'hello.txt', kind: 'file', size: 9n }])
    const [entry] = page.items
    if (entry === undefined) throw new Error('ZIP namespace listed no entry')
    expect(await session.operations().invoke('extract-entry', { entryId: entry.id })).toMatchObject(
      {
        state: 'ok',
        output: { kind: 'bytes', value: new TextEncoder().encode('hello zip') },
      },
    )
    await namespace.release()
    await session.dispose()

    const deflated = zipEntry('compressed.txt', 'portable deflate', 8)
    const codec = await codecFor('zip')
    const source = byteSource('zip', deflated)
    const deflatedSession = await codec.open(inputFor(source), 'inspect', budget)
    const deflatedNamespace = await deflatedSession.dataSource(
      'common.view/namespace-entry-source',
      1,
    )
    const deflatedPage = await (deflatedNamespace.value as NamespaceEntrySource).list('', {
      limit: 10,
    })
    const [deflatedEntry] = deflatedPage.items
    if (deflatedEntry === undefined) throw new Error('deflated ZIP namespace listed no entry')
    expect(
      await deflatedSession.operations().invoke('extract-entry', { entryId: deflatedEntry.id }),
    ).toMatchObject({
      state: 'ok',
      output: { kind: 'bytes', value: new TextEncoder().encode('portable deflate') },
    })
    await deflatedNamespace.release()
    await deflatedSession.dispose()
  })

  it('publishes an honest metadata-only MP3 transport snapshot', async () => {
    const session = await open('mp3')
    const lease = await session.dataSource('common.view/transport-source', 1)
    const transport = lease.value as TransportSource
    const snapshot = await transport.snapshot()
    expect(snapshot).toMatchObject({
      state: 'idle',
      durationMs: expect.any(Number),
      seekable: true,
      controls: {
        playPause: 'media.play-pause',
        seek: 'media.seek',
        setRate: 'media.set-rate',
        selectTrack: 'media.select-track',
      },
      tracks: [{ kind: 'audio', selected: true }],
    })
    expect((await session.descriptor()).constraints.unsupportedFeatures).toContain(
      'pcm-decoder-provider',
    )
    const events = transport.events()[Symbol.asyncIterator]()
    await events.next()
    expect(await session.operations().invoke('transport-play-pause', null)).toMatchObject({
      state: 'ok',
    })
    expect(await events.next()).toMatchObject({
      value: { kind: 'snapshot', snapshot: { state: 'playing' } },
    })
    await events.return?.()
    await lease.release()
    await session.dispose()
  })

  it('opens declared thumbnail intents without starting a pixel or frame decoder', async () => {
    const originalDecoder = globalThis.DecompressionStream
    let decoderStarts = 0
    function forbiddenThumbnailDecoder() {
      decoderStarts += 1
      throw new Error('thumbnail opened a full decoder')
    }
    Object.defineProperty(globalThis, 'DecompressionStream', {
      configurable: true,
      value: forbiddenThumbnailDecoder,
    })
    const thumbnailBudget: ResourceBudget = {
      maxInputBytes: 64_000n,
      maxDepth: 16,
      maxNodes: 64,
      maxScalarBytes: 16_384,
      maxDiagnostics: 16,
    }
    try {
      for (const format of ['png', 'jpeg'] as const) {
        const codec = await codecFor(format)
        const source = byteSource(format)
        const session = await codec.open(inputFor(source), 'thumbnail', thumbnailBudget)
        const lease = await session.dataSource('common.view/raster-image-source', 1)
        expect((await (lease.value as RasterImageSource).info()).decodedAccess).toBe(false)
        await lease.release()
        await session.dispose()
      }
      for (const format of ['mp4', 'webm'] as const) {
        const codec = await codecFor(format)
        const source = byteSource(format)
        const session = await codec.open(inputFor(source), 'thumbnail', thumbnailBudget)
        const lease = await session.dataSource('common.view/video-media-source', 1)
        expect((await (lease.value as VideoMediaSource).info()).frameAccess).toBe(false)
        await lease.release()
        await session.dispose()
      }
      expect(decoderStarts).toBe(0)
    } finally {
      Object.defineProperty(globalThis, 'DecompressionStream', {
        configurable: true,
        value: originalDecoder,
      })
    }
  })

  it.each(['svg', 'obj', 'gltf', 'markdown'] as const)(
    'publishes independent text and tree sources for %s',
    async format => {
      const session = await open(format)
      const text = await session.dataSource('common.view/text-data-source', 1)
      const info = await (text.value as TextDataSource).info()
      expect(info.encoding).toBe('utf-8')
      const tree = await session.dataSource('common.view/tree-data-source', 1)
      const root = await (tree.value as TreeDataSource).root()
      expect(
        (await (tree.value as TreeDataSource).children(root, { limit: 20 })).items.length,
      ).toBeGreaterThan(0)
      await tree.release()
      await text.release()
      await session.dispose()
    },
  )

  it('publishes format-neutral media sources without cross-loading sibling codecs', async () => {
    for (const format of ['png', 'jpeg'] as const) {
      const session = await open(format)
      const lease = await session.dataSource('common.view/raster-image-source', 1)
      const source = lease.value as RasterImageSource
      expect(await source.info()).toMatchObject({
        width: 2,
        height: 3,
        decodedAccess: format === 'png',
      })
      const encoded = await source.encoded()
      expect((await encoded.descriptor()).mediaType).toMatch(/^image\//u)
      expect((await encoded.read(0n, 8)).byteLength).toBeGreaterThan(0)
      if (format === 'png') {
        const region = await source.readRegion?.({
          x: 0,
          y: 0,
          width: 2,
          height: 1,
          pixelFormat: 'rgba8',
          maxBytes: 8,
        })
        expect(region?.pixels).toEqual(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]))
        await expect(
          source.readRegion?.({
            x: 0,
            y: 0,
            width: 2,
            height: 3,
            pixelFormat: 'rgba8',
            maxBytes: 8,
          }),
        ).rejects.toThrow(/maxBytes/u)
      }
      await lease.release()
      await session.dispose()
    }

    for (const format of ['mp3', 'ogg'] as const) {
      const session = await open(format)
      const lease = await session.dataSource('common.view/audio-media-source', 1)
      const source = lease.value as AudioMediaSource
      expect((await source.info()).tracks).toHaveLength(1)
      const encoded = await source.encoded()
      expect((await encoded.descriptor()).mediaType).toMatch(/^audio\//u)
      await lease.release()
      await session.dispose()
    }

    const svgSession = await open('svg')
    const vectorLease = await svgSession.dataSource('common.view/vector-scene-source', 1)
    const vector = vectorLease.value as VectorSceneSource
    expect(await vector.info()).toMatchObject({ nodes: 5, paths: 1, textNodes: 1 })
    expect(await vector.document()).toMatchObject({ profile: 'uvg.secure-static.v1' })
    await vectorLease.release()
    await svgSession.dispose()

    const objSession = await open('obj')
    const objLease = await objSession.dataSource('common.view/model-scene-source', 1)
    const obj = objLease.value as ModelSceneSource
    expect(await obj.info()).toMatchObject({ geometryAccess: 'decoded', primitives: 1 })
    const primitive = await obj.primitive?.('primitive-0', { maxBytes: 1024 })
    expect(primitive?.positions).toHaveLength(9)
    expect(primitive?.indices).toEqual(new Uint32Array([0, 1, 2]))
    await objLease.release()
    await objSession.dispose()

    const gltfSession = await open('gltf')
    const gltfLease = await gltfSession.dataSource('common.view/model-scene-source', 1)
    const gltf = gltfLease.value as ModelSceneSource
    expect(await gltf.info()).toMatchObject({ geometryAccess: 'metadata-only', meshes: 1 })
    expect(gltf.primitive).toBeUndefined()
    await gltfLease.release()

    const graphLease = await gltfSession.dataSource('common.view/relation-graph-source', 1)
    const graph = graphLease.value as RelationGraphSource
    const summary = await graph.summary()
    expect(summary).toMatchObject({ completeness: 'complete' })
    expect(summary.totalNodes).toBeGreaterThan(5)
    expect(summary.types.find(type => type.id === 'mesh')).toMatchObject({ count: 1 })
    const firstNodes = await graph.nodes({ limit: 3 })
    expect(firstNodes.items).toHaveLength(3)
    expect(firstNodes.nextCursor).toBe('3')
    const remainingNodes = await graph.nodes({
      ...(firstNodes.nextCursor === undefined ? {} : { cursor: firstNodes.nextCursor }),
      limit: 100,
    })
    expect(firstNodes.items.length + remainingNodes.items.length).toBe(summary.totalNodes)
    const graphEdges = await graph.edges({ limit: 100 })
    expect(graphEdges.items).toContainEqual(expect.objectContaining({ role: 'uri', dead: true }))
    await graphLease.release()

    const factsLease = await gltfSession.dataSource('common.view/subject-facts-source', 1)
    const subjectFacts = factsLease.value as SubjectFactsSource
    const factSummary = await subjectFacts.summary()
    expect(factSummary).toMatchObject({
      groupCount: 3,
      identity: { kind: 'file', type: 'glTF 2.x' },
    })
    const cardSections = await loadSubjectCardSections(subjectFacts)
    expect(cardSections[0]).toMatchObject({ kind: 'header', title: 'sample.gltf' })
    expect(cardSections).toContainEqual(expect.objectContaining({ kind: 'fields', id: 'contents' }))
    expect(cardSections).toContainEqual(
      expect.objectContaining({ kind: 'links', id: 'related-subjects' }),
    )
    const descriptor = await gltfSession.descriptor()
    expect(JSON.stringify(descriptor)).not.toMatch(/viewerId|viewerFactory|presentationPlan/u)
    await factsLease.release()
    await gltfSession.dispose()

    for (const format of ['mp4', 'webm'] as const) {
      const session = await open(format)
      const videoLease = await session.dataSource('common.view/video-media-source', 1)
      const video = videoLease.value as VideoMediaSource
      expect((await video.info()).tracks.some(track => track.kind === 'video')).toBe(true)
      expect((await (await video.encoded()).descriptor()).mediaType).toMatch(/^video\//u)
      await videoLease.release()
      await session.dispose()
    }
  })

  it('keeps every codec entrypoint and package index import-isolated', async () => {
    const allRoots = Object.values(codecRoots).map(path => path.replaceAll('\\', '/'))
    const allEntrypoints = Object.entries(entrypoints)
    for (const format of Object.keys(codecRoots) as Format[]) {
      for (const entrypoint of [entrypoints[format], 'src/index.js']) {
        const result = await build({
          absWorkingDir: codecRoots[format],
          entryPoints: [entrypoint],
          bundle: true,
          format: 'esm',
          platform: 'neutral',
          packages: 'external',
          write: false,
          metafile: true,
          logLevel: 'silent',
        })
        const inputs = Object.keys(result.metafile?.inputs ?? {}).map(path =>
          path.replaceAll('\\', '/'),
        )
        for (const otherRoot of allRoots.filter(
          root => root !== codecRoots[format].replaceAll('\\', '/'),
        )) {
          expect(
            inputs.some(input => input.includes(otherRoot)),
            `${format} imported ${otherRoot}`,
          ).toBe(false)
        }
        for (const [otherFormat, otherEntrypoint] of allEntrypoints) {
          if (otherFormat === format) continue
          expect(
            inputs.some(input => input.endsWith(otherEntrypoint)),
            `${format} imported sibling ${otherFormat}`,
          ).toBe(false)
        }
        if (entrypoint === 'src/index.js') expect(inputs).toEqual(['src/index.js'])
      }
    }
  })
})
