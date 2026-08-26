import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import {
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openNestedSubject,
  openSubject,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type ModelAnimationSource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { proves } from '@modkitx-x3/testkit'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { M3SectionList } from '../src/m3/native/binary/sections.js'
import { installM3PlatformAdapters } from '../src/m3/native/platform.js'
import { decodeM3Animations } from '../src/m3/animation.node.js'
import { loadM3StructuresXml } from '../src/m3/native/binary/parser.js'

installM3PlatformAdapters({ DOMParser })

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const logicalId =
  'campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3'
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'm3-animation-preflight', classes: ['read-source'] } as const
const TEST_PATH = 'extensions/blizzard/models/test/m3-animation.test.ts'
const MODEL_BYTES = 60_128
const MODEL_SHA256 = 'fb7680019ca7ec88aeb37591a7477c2555dd674d57f0c7486736ccb11919a436'
const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

const executionBackends = createExecutionBackendRegistry([
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

async function inventory() {
  const inputs = await Promise.all(
    [
      ['blizzard', 'casc'],
      ['blizzard', 'models'],
    ].map(async parts => ({
      ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  return buildInventory(inputs, createHostContributionContractRegistry())
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function referencedString(sections: M3SectionList, reference: unknown): string | null {
  if (reference === null || typeof reference !== 'object') return null
  const value = reference as { readonly entries?: unknown; readonly index?: unknown }
  if (!Number.isInteger(value.entries) || Number(value.entries) <= 0) return null
  if (!Number.isInteger(value.index) || Number(value.index) < 0) return null
  const section = sections.getSectionByReference(value)
  if (section?.desc.history.name !== 'CHAR') return null
  const content = section.content
  if (!Array.isArray(content) || content.length < Number(value.entries)) return null
  const bytes = Uint8Array.from(content.slice(0, Number(value.entries)), item => Number(item))
  const zero = bytes.indexOf(0)
  return new TextDecoder('utf-8', { fatal: true }).decode(
    zero < 0 ? bytes : bytes.subarray(0, zero),
  )
}

function proveAnimation(note: string): void {
  proves({ contributionId: 'org.modkitx/m3', operation: 'inspect', test: TEST_PATH, note })
}

function writeTag(bytes: Uint8Array, offset: number, tag: string): void {
  for (let index = 0; index < 4; index += 1) bytes[offset + index] = tag.charCodeAt(3 - index)
}

function recordsBytes(
  desc: { readonly size: number; instance(): Record<string, unknown> },
  records: readonly Record<string, unknown>[],
): Uint8Array {
  const buffer = new ArrayBuffer(desc.size * records.length)
  for (const [index, record] of records.entries()) {
    Object.assign(desc.instance(), record).toBuffer(buffer, index * desc.size)
  }
  return new Uint8Array(buffer)
}

function numberRecords(
  desc: { readonly size: number; instance(): Record<string, unknown> },
  values: readonly number[],
): Uint8Array {
  const buffer = new ArrayBuffer(desc.size * values.length)
  for (const [index, value] of values.entries()) {
    const record = desc.instance()
    record.value = value
    record.toBuffer(buffer, index * desc.size)
  }
  return new Uint8Array(buffer)
}

interface SyntheticAnimationOptions {
  readonly start?: number
  readonly end?: number
  readonly stcAnimId?: number
  readonly boneAnimId?: number
  readonly ambiguousTarget?: boolean
  readonly emptySequences?: boolean
  readonly frameTicks?: readonly number[]
}

async function buildAnimationM3(options: SyntheticAnimationOptions = {}): Promise<Uint8Array> {
  const structures = await loadM3StructuresXml(
    await readFile(
      join(repoRoot, 'extensions', 'blizzard', 'models', 'src', 'm3', 'native', 'structures.xml'),
      'utf8',
    ),
  )
  const desc = (tag: string, version: number) => structures[tag].getVersion(version, 34, structures)
  const headerDesc = desc('MD34', 11)
  const modelDesc = desc('MODL', 20)
  const sequenceDesc = desc('SEQS', 2)
  const stcDesc = desc('STC_', 4)
  const stgDesc = desc('STG_', 0)
  const stsDesc = desc('STS_', 0)
  const boneDesc = desc('BONE', 1)
  const sd3vDesc = desc('SD3V', 0)
  const u32Desc = desc('U32_', 0)
  const i32Desc = desc('I32_', 0)

  const sequenceName = new TextEncoder().encode('Walk\0')
  const stcName = new TextEncoder().encode('Walk_full\0')
  const stgName = new TextEncoder().encode('Walk\0')
  const boneName = new TextEncoder().encode('Root\0')
  const stcAnimId = options.stcAnimId ?? 0x1020_3040
  const boneAnimId = options.boneAnimId ?? stcAnimId
  const start = options.start ?? 100
  const end = options.end ?? 220
  const frameTicks = options.frameTicks ?? [start, end]
  const boneCount = options.ambiguousTarget === true ? 2 : 1
  const declared = options.emptySequences === true ? 0 : 1

  const model = modelDesc.instance()
  Object.assign(model.sequences, { entries: declared, index: 2, flags: 0 })
  Object.assign(model.sequence_transformation_collections, {
    entries: declared,
    index: 4,
    flags: 0,
  })
  Object.assign(model.sequence_transformation_groups, { entries: declared, index: 9, flags: 0 })
  Object.assign(model.sts, { entries: declared, index: 12, flags: 0 })
  Object.assign(model.bones, { entries: boneCount, index: 14, flags: 0 })

  const sequence = sequenceDesc.instance()
  sequence.id = 0
  sequence.index = 0
  Object.assign(sequence.name, { entries: sequenceName.byteLength, index: 3, flags: 0 })
  sequence.anim_ms_start = start
  sequence.anim_ms_end = end
  sequence.flags = 0
  sequence.frequency = 100

  const stc = stcDesc.instance()
  Object.assign(stc.name, { entries: stcName.byteLength, index: 5, flags: 0 })
  stc.sts_index = 0
  stc.sts_index_fb = 0
  Object.assign(stc.anim_ids, { entries: 1, index: 6, flags: 0 })
  Object.assign(stc.anim_refs, { entries: 1, index: 7, flags: 0 })
  stc.ref_count = 1
  Object.assign(stc.sd3v, { entries: 1, index: 8, flags: 0 })

  const stg = stgDesc.instance()
  Object.assign(stg.name, { entries: stgName.byteLength, index: 10, flags: 0 })
  Object.assign(stg.stc_indices, { entries: 1, index: 11, flags: 0 })

  const sts = stsDesc.instance()
  Object.assign(sts.anim_ids, { entries: 1, index: 13, flags: 0 })

  const bone = boneDesc.instance()
  bone.id = 0
  Object.assign(bone.name, { entries: boneName.byteLength, index: 15, flags: 0 })
  bone.parent = -1
  bone.location.header.id = boneAnimId
  bone.location.header.interpolation = 1
  bone.location.header.flags = 6
  bone.rotation.header.id = 0x5060_7080
  bone.scale.header.id = 0x90a0_b0c0
  const bones = [bone]
  if (options.ambiguousTarget === true) {
    const duplicate = boneDesc.instance()
    duplicate.id = 1
    Object.assign(duplicate.name, { entries: boneName.byteLength, index: 15, flags: 0 })
    duplicate.parent = -1
    duplicate.location.header.id = boneAnimId
    duplicate.location.header.interpolation = 1
    duplicate.location.header.flags = 6
    duplicate.rotation.header.id = 0x5060_7081
    duplicate.scale.header.id = 0x90a0_b0c1
    bones.push(duplicate)
  }

  const sd3v = sd3vDesc.instance()
  sd3v.fend = end
  Object.assign(sd3v.frames, { entries: frameTicks.length, index: 16, flags: 0 })

  const sections = [
    { tag: 'MD34', version: 11, repetitions: 1, bytes: new Uint8Array(headerDesc.size) },
    { tag: 'MODL', version: 20, repetitions: 1, bytes: recordsBytes(modelDesc, [model]) },
    { tag: 'SEQS', version: 2, repetitions: 1, bytes: recordsBytes(sequenceDesc, [sequence]) },
    { tag: 'CHAR', version: 0, repetitions: sequenceName.byteLength, bytes: sequenceName },
    { tag: 'STC_', version: 4, repetitions: 1, bytes: recordsBytes(stcDesc, [stc]) },
    { tag: 'CHAR', version: 0, repetitions: stcName.byteLength, bytes: stcName },
    { tag: 'U32_', version: 0, repetitions: 1, bytes: numberRecords(u32Desc, [stcAnimId]) },
    { tag: 'U32_', version: 0, repetitions: 1, bytes: numberRecords(u32Desc, [(2 << 16) | 0]) },
    { tag: 'SD3V', version: 0, repetitions: 1, bytes: recordsBytes(sd3vDesc, [sd3v]) },
    { tag: 'STG_', version: 0, repetitions: 1, bytes: recordsBytes(stgDesc, [stg]) },
    { tag: 'CHAR', version: 0, repetitions: stgName.byteLength, bytes: stgName },
    { tag: 'U32_', version: 0, repetitions: 1, bytes: numberRecords(u32Desc, [0]) },
    { tag: 'STS_', version: 0, repetitions: 1, bytes: recordsBytes(stsDesc, [sts]) },
    { tag: 'U32_', version: 0, repetitions: 1, bytes: numberRecords(u32Desc, [stcAnimId]) },
    { tag: 'BONE', version: 1, repetitions: bones.length, bytes: recordsBytes(boneDesc, bones) },
    { tag: 'CHAR', version: 0, repetitions: boneName.byteLength, bytes: boneName },
    {
      tag: 'I32_',
      version: 0,
      repetitions: frameTicks.length,
      bytes: numberRecords(i32Desc, frameTicks),
    },
  ]
  let cursor = 0
  const offsets = sections.map(section => {
    const offset = cursor
    cursor += section.bytes.byteLength
    return offset
  })
  const indexOffset = cursor
  const bytes = new Uint8Array(indexOffset + sections.length * 16)
  for (const [index, section] of sections.entries()) bytes.set(section.bytes, offsets[index])
  const view = new DataView(bytes.buffer)
  for (const [index, section] of sections.entries()) {
    const offset = indexOffset + index * 16
    writeTag(bytes, offset, section.tag)
    view.setUint32(offset + 4, offsets[index], true)
    view.setUint32(offset + 8, section.repetitions, true)
    view.setUint32(offset + 12, section.version, true)
  }
  const header = headerDesc.instance()
  header.tag = 0x4d443334
  header.index_offset = indexOffset
  header.index_size = sections.length
  Object.assign(header.model, { entries: 1, index: 1, flags: 0 })
  header.toBuffer(bytes.buffer, 0)
  return bytes
}

function changeRepetitions(
  bytes: Uint8Array,
  sectionIndex: number,
  repetitions: number,
): Uint8Array {
  const changed = bytes.slice()
  const view = new DataView(changed.buffer)
  const indexOffset = view.getUint32(4, true)
  view.setUint32(indexOffset + sectionIndex * 16 + 8, repetitions, true)
  return changed
}

async function openMemory(bytes: Uint8Array) {
  const uri = 'memory://m3-animation/fixture.m3'
  const source: ArtifactByteSource = Object.freeze({
    kind: 'bytes' as const,
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${createHash('sha256').update(bytes).digest('hex')}`),
    size: BigInt(bytes.byteLength),
    async read(offset: bigint, length: number) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  })
  return openSubject({
    inventory: await inventory(),
    source,
    path: 'fixture.m3',
    intent: 'full',
    target,
    grant,
    budget,
    executionBackends,
  })
}

describe('M3 SEQS/STC decoding', () => {
  it('normalizes native millisecond timestamps into one explicitly targeted BONE channel', async () => {
    const decoded = await decodeM3Animations(await buildAnimationM3(), budget)
    expect(decoded).toMatchObject({
      fatal: false,
      supportedChannels: 1,
      unsupportedChannels: 0,
      rejectedTargets: 0,
    })
    expect(decoded.clips).toEqual([
      {
        id: 'm3-sequence-0',
        name: 'Walk',
        kind: 'animation',
        provenance: 'direct',
        frames: 2,
        hierarchyId: 'm3/bone-table',
        channels: [
          {
            target: 'bone/0',
            kind: 'translation',
            firstFrame: 0,
            lastFrame: 1,
          },
        ],
      },
    ])
    expect(decoded.clips[0]).not.toHaveProperty('frameRate')
    expect(decoded.timelineContainers).toEqual([
      { index: 0, name: 'Walk_full', channels: 1, unsupportedChannels: 0, frames: 2 },
    ])
    proveAnimation('SEQS bounds and an STS-validated STC id publish one explicit BONE channel')
  })

  it('publishes the animation source and keeps keyframes visibly lost in the receipt', async () => {
    const opened = await openMemory(await buildAnimationM3())
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') return
    try {
      const descriptor = await opened.session.descriptor()
      expect(descriptor.dataSources).toContainEqual(
        expect.objectContaining({ contract: 'common.view/model-animation-source', major: 1 }),
      )
      const lease = await opened.session.dataSource('common.view/model-animation-source', 1)
      try {
        const source = lease.value as ModelAnimationSource
        expect(await source.info()).toEqual({ clips: 1, channelled: 1, companionBound: 0 })
        const first = await source.clips({ limit: 1 })
        expect(first.items).toHaveLength(1)
        expect(first.nextCursor).toBeUndefined()
        expect(first.items[0]?.channels[0]).toMatchObject({
          target: 'bone/0',
          kind: 'translation',
        })
      } finally {
        await lease.release()
      }
      const receipt = descriptor.metadata.find(group => group.id === 'uv-projection-receipt')
        ?.entries[0]?.value as
        | { readonly planes: readonly { readonly planeId: string; readonly state: string }[] }
        | undefined
      expect(receipt?.planes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ planeId: 'animation', state: 'normalized' }),
          expect.objectContaining({ planeId: 'animation-bone-targets', state: 'normalized' }),
          expect.objectContaining({ planeId: 'animation-native-time-bounds', state: 'lost' }),
          expect.objectContaining({ planeId: 'animation-sd-keyframes', state: 'lost' }),
        ]),
      )
      expect(receipt?.planes).not.toContainEqual(
        expect.objectContaining({ planeId: 'animation-sd-keyframes', state: 'preserved' }),
      )
      proveAnimation(
        'the host publishes paged clips while the receipt refuses to overclaim SD keys',
      )
    } finally {
      await opened.session.dispose()
    }
  })

  it.each([
    ['SEQS', 2, 'x3.m3/animation-seqs-truncated'],
    ['STC_', 4, 'x3.m3/animation-stc-truncated'],
  ] as const)('names a truncated %s table before schema parsing', async (_tag, section, code) => {
    const decoded = await decodeM3Animations(
      changeRepetitions(await buildAnimationM3(), section, 2),
      budget,
    )
    expect(decoded).toMatchObject({ fatal: true, clips: [] })
    expect(decoded.issues).toContainEqual(expect.objectContaining({ code }))
    proveAnimation(
      `${_tag} truncation is a coded refusal before the schema parser allocates records`,
    )
  })

  it('drops invalid SEQS bounds instead of inventing a duration', async () => {
    const bytes = await buildAnimationM3({ start: 500, end: 100 })
    const decoded = await decodeM3Animations(bytes, budget)
    expect(decoded).toMatchObject({ fatal: false, clips: [], invalidBounds: 1 })
    expect(decoded.issues).toContainEqual(
      expect.objectContaining({ code: 'x3.m3/animation-bounds-refused' }),
    )
    const opened = await openMemory(bytes)
    expect(opened.state).toBe('opened')
    if (opened.state === 'opened') {
      try {
        expect((await opened.session.descriptor()).dataSources).not.toContainEqual(
          expect.objectContaining({ contract: 'common.view/model-animation-source' }),
        )
      } finally {
        await opened.session.dispose()
      }
    }
    proveAnimation('an end-before-start SEQS range is refused rather than normalized or clamped')
  })

  it.each([
    ['nonexistent', { stcAnimId: 0x1020_3040, boneAnimId: 0x1020_3041 }],
    ['ambiguous', { ambiguousTarget: true }],
  ] as const)('%s BONE target does not create an STC channel', async (_kind, options) => {
    const decoded = await decodeM3Animations(await buildAnimationM3(options), budget)
    expect(decoded.clips[0]).toMatchObject({ channels: [], unsupportedChannels: 1 })
    expect(decoded).toMatchObject({ supportedChannels: 0, rejectedTargets: 1 })
    expect(decoded.issues).toContainEqual(
      expect.objectContaining({ code: 'x3.m3/animation-target-refused' }),
    )
    proveAnimation(`a ${_kind} STC target never becomes a name-guessed or positional BONE channel`)
  })

  it('publishes no animation facet when MODL declares no SEQS records', async () => {
    const bytes = await buildAnimationM3({ emptySequences: true })
    expect(await decodeM3Animations(bytes, budget)).toMatchObject({ clips: [], fatal: false })
    const opened = await openMemory(bytes)
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') return
    try {
      const descriptor = await opened.session.descriptor()
      expect(descriptor.dataSources).not.toContainEqual(
        expect.objectContaining({ contract: 'common.view/model-animation-source' }),
      )
      const receipt = descriptor.metadata.find(group => group.id === 'uv-projection-receipt')
        ?.entries[0]?.value as
        | { readonly planes: readonly { readonly planeId: string; readonly state: string }[] }
        | undefined
      expect(receipt?.planes).toContainEqual(
        expect.objectContaining({ planeId: 'animation', state: 'lost' }),
      )
      proveAnimation(
        'an empty MODL.sequences reference publishes neither an empty facet nor a clip',
      )
    } finally {
      await opened.session.dispose()
    }
  })

  it('fails closed on maxNodes and maxScalarBytes before animation publication', async () => {
    const bytes = await buildAnimationM3()
    const nodes = await decodeM3Animations(bytes, { ...budget, maxNodes: 1 })
    const scalar = await decodeM3Animations(bytes, { ...budget, maxScalarBytes: 1 })
    for (const decoded of [nodes, scalar]) {
      expect(decoded).toMatchObject({ fatal: true, clips: [] })
      expect(decoded.issues).toContainEqual(
        expect.objectContaining({ code: 'x3.m3/animation-budget-exceeded' }),
      )
    }
    proveAnimation('animation tables are bounded by maxNodes and maxScalarBytes before parsing')
  })

  it('honours cancellation before parsing', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      decodeM3Animations(await buildAnimationM3(), budget, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    proveAnimation('an already-cancelled animation decode performs no schema work')
  })
})

describe('M3 animation corpus stop/go', () => {
  it('measures the pinned M3 through the host/CASC route', async () => {
    const sc2Root = process.env.MODKITX_SC2_ROOT?.trim()
    if (sc2Root === undefined) throw new Error('MODKITX_SC2_ROOT is required')
    const mount = await new VirtualFileSystem()
      .registerProvider(createFileVfsProvider())
      .openMount(pathToFileURL(sc2Root).href)
    const casc = await openSubject({
      inventory: await inventory(),
      source: artifactNamespaceSourceFromVfsMount(mount),
      path: sc2Root,
      intent: 'full',
      target,
      grant,
      budget,
      executionBackends,
    })
    if (casc.state !== 'opened') throw new Error(`CASC did not open: ${casc.state}`)
    try {
      const extracted = await casc.session
        .operations()
        .invoke('extract-entry', { entryId: logicalId })
      if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
        throw new Error(`CASC extraction failed for ${logicalId}`)
      }
      const bytes = extracted.output.value
      const xml = await readFile(
        join(repoRoot, 'extensions', 'blizzard', 'models', 'src', 'm3', 'native', 'structures.xml'),
        'utf8',
      )
      const sections = await M3SectionList.load(bufferOf(bytes), xml)
      const sequenceSection = sections.getSectionByReference(sections.model?.sequences)
      const stcSection = sections.getSectionByReference(
        sections.model?.sequence_transformation_collections,
      )
      const stsSection = sections.getSectionByReference(sections.model?.sts)
      const sequences = (sequenceSection?.content ?? []).map(sequence => ({
        name: referencedString(sections, sequence.name),
        start: Number(sequence.anim_ms_start),
        end: Number(sequence.anim_ms_end),
        flags: Number(sequence.flags),
        frequency: Number(sequence.frequency),
      }))
      const stcs = (stcSection?.content ?? []).map(stc => ({
        name: referencedString(sections, stc.name),
        refCount: Number(stc.ref_count),
        animIds: Number(stc.anim_ids?.entries ?? 0),
        animRefs: Number(stc.anim_refs?.entries ?? 0),
        trackContainers: [
          'sdev',
          'sd2v',
          'sd3v',
          'sd4q',
          'sdcc',
          'sdr3',
          'sdu8',
          'sds6',
          'sdu6',
          'sds3',
          'sdu3',
          'sdfg',
          'sdmb',
        ].reduce((sum, key) => sum + Number(stc[key]?.entries ?? 0), 0),
      }))
      const sdFields = [
        'sdev',
        'sd2v',
        'sd3v',
        'sd4q',
        'sdcc',
        'sdr3',
        'sdu8',
        'sds6',
        'sdu6',
        'sds3',
        'sdu3',
        'sdfg',
        'sdmb',
      ] as const
      const sdFrameCounts = (stcSection?.content ?? []).flatMap(stc =>
        sdFields.flatMap(field =>
          (sections.getSectionByReference(stc[field])?.content ?? []).map(sd => ({
            field,
            frames:
              sections.getSectionByReference(sd.frames)?.content.map(value => Number(value)) ?? [],
          })),
        ),
      )
      const distinctSdFrames = new Set(sdFrameCounts.flatMap(track => track.frames)).size
      const digest = createHash('sha256').update(bytes).digest('hex')
      const decoded = await decodeM3Animations(bytes, budget)
      expect(logicalId).not.toMatch(/^(?:[A-Za-z]:|[\\/]|[a-z][a-z0-9+.-]*:)/u)
      expect(bytes.byteLength).toBe(MODEL_BYTES)
      expect(digest).toBe(MODEL_SHA256)
      expect(sequenceSection?.desc.history.name).toBe('SEQS')
      expect(stcSection?.desc.history.name).toBe('STC_')
      expect(sequences).toEqual([{ name: 'Stand', start: 0, end: 4000, flags: 0, frequency: 100 }])
      expect(stcs).toEqual([
        {
          name: 'Stand_full',
          refCount: 0,
          animIds: 6,
          animRefs: 6,
          trackContainers: 6,
        },
      ])
      expect(decoded.clips).toHaveLength(1)
      expect(decoded.clips[0]).toMatchObject({
        name: 'Stand',
        frames: 110,
        channels: [],
        unsupportedChannels: 6,
      })
      expect(decoded.clips[0]).not.toHaveProperty('frameRate')
      expect(distinctSdFrames).toBe(110)
      expect(decoded.clips[0]?.frames).toBe(distinctSdFrames)
      expect(decoded).toMatchObject({
        supportedChannels: 0,
        unsupportedChannels: 6,
        rejectedTargets: 6,
        invalidBounds: 0,
        fatal: false,
      })
      const nested = await openNestedSubject({
        parent: casc.session,
        entryId: logicalId,
        inventory: await inventory(),
        executionBackends,
        target,
        grant,
        budget,
      })
      if (nested.result.state !== 'opened') {
        throw new Error(JSON.stringify(nested.result.diagnostics).slice(0, 1200))
      }
      try {
        expect(nested.result.selected.contributionId).toBe('org.modkitx/m3')
        const descriptor = await nested.result.session.descriptor()
        const lease = await nested.result.session.dataSource(
          'common.view/model-animation-source',
          1,
        )
        try {
          const source = lease.value as ModelAnimationSource
          expect(await source.info()).toEqual({ clips: 1, channelled: 0, companionBound: 0 })
          const page = await source.clips({ limit: 1 })
          expect(page.items).toEqual([
            {
              id: 'm3-sequence-0',
              name: 'Stand',
              kind: 'animation',
              provenance: 'direct',
              frames: 110,
              hierarchyId: 'm3/bone-table',
              channels: [],
              unsupportedChannels: 6,
            },
          ])
          expect(page.nextCursor).toBeUndefined()
        } finally {
          await lease.release()
        }
        const receipt = descriptor.metadata.find(group => group.id === 'uv-projection-receipt')
          ?.entries[0]?.value as
          | { readonly planes: readonly { readonly planeId: string; readonly state: string }[] }
          | undefined
        expect(receipt?.planes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ planeId: 'animation', state: 'normalized' }),
            expect.objectContaining({ planeId: 'animation-bone-targets', state: 'lost' }),
            expect.objectContaining({ planeId: 'animation-native-time-bounds', state: 'lost' }),
            expect.objectContaining({ planeId: 'animation-sd-keyframes', state: 'lost' }),
          ]),
        )
        expect(JSON.stringify(receipt)).not.toMatch(/(?:[A-Za-z]:[\\/]|file:\/\/|\\\\)/u)
      } finally {
        await nested.result.session.dispose()
      }
      console.info(
        `[sc2-live] ${logicalId}: bytes=${bytes.byteLength}, sha256=${digest}, ` +
          `sequence=Stand, bounds=0..4000ms, stc=Stand_full, refs=6, ` +
          `sampleFrames=${distinctSdFrames}, supportedBoneChannels=0, unsupportedChannels=6, ` +
          `sts=${stsSection?.content.length ?? 0}`,
      )
      proveAnimation(
        'the pinned CASC sample publishes Stand while all six non-BONE STC channels remain explicit unsupported data',
      )
    } finally {
      await casc.session.dispose()
    }
  }, 300_000)
})
