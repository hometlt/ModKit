import { readFile } from 'node:fs/promises'
import { DOMParser } from '@xmldom/xmldom'
import { M3SectionList } from './native/binary/sections.js'
import { installM3PlatformAdapters } from './native/platform.js'

installM3PlatformAdapters({ DOMParser })

const SD_FIELDS = Object.freeze([
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
])
const BONE_CHANNELS = Object.freeze([
  Object.freeze({ field: 'location', kind: 'translation' }),
  Object.freeze({ field: 'rotation', kind: 'rotation' }),
  Object.freeze({ field: 'scale', kind: 'scale' }),
])
const RECORD_BYTES = Object.freeze({
  SEQS: Object.freeze({ 1: 96, 2: 92 }),
  STC_: Object.freeze({ 4: 204 }),
  STG_: Object.freeze({ 0: 24 }),
  STS_: Object.freeze({ 0: 28 }),
})

let structuresXml

async function schemaText() {
  structuresXml ??= await readFile(new URL('./native/structures.xml', import.meta.url), 'utf8')
  return structuresXml
}

function arrayBufferOf(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function reversedTag(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) return ''
  return String.fromCharCode(
    bytes[offset + 3],
    bytes[offset + 2],
    bytes[offset + 1],
    bytes[offset],
  ).replaceAll('\0', '')
}

function issue(code, message, severity = 'warning', category = 'structure') {
  return Object.freeze({ id: code, code, category, severity, message })
}

function emptyResult(issues = [], fatal = false, declaredSequences = 0) {
  return Object.freeze({
    declaredSequences,
    clips: Object.freeze([]),
    timelineContainers: Object.freeze([]),
    supportedChannels: 0,
    unsupportedChannels: 0,
    invalidBounds: 0,
    rejectedTargets: 0,
    decodedBytes: 0,
    issues: Object.freeze(issues),
    fatal,
  })
}

function animationIndexPreflight(bytes, budget) {
  const tag = reversedTag(bytes, 0)
  const headerBytes = tag === 'MD34' ? 24 : tag === 'MD33' ? 20 : 0
  if (headerBytes === 0 || bytes.byteLength < headerBytes) {
    return {
      present: false,
      decodedBytes: 0,
      issue: issue('x3.m3/animation-container-invalid', 'the M3 header is invalid or truncated'),
    }
  }
  const view = viewOf(bytes)
  const indexOffset = view.getUint32(4, true)
  const indexCount = view.getUint32(8, true)
  const indexBytes = indexCount * 16
  if (
    !Number.isSafeInteger(indexBytes) ||
    indexOffset < headerBytes ||
    indexOffset + indexBytes > bytes.byteLength
  ) {
    return {
      present: false,
      decodedBytes: 0,
      issue: issue(
        'x3.m3/animation-container-invalid',
        'the M3 section index is invalid or outside the source',
      ),
    }
  }
  if (indexCount > budget.maxNodes) {
    return {
      present: false,
      decodedBytes: 0,
      issue: issue(
        'x3.m3/animation-budget-exceeded',
        'the M3 section index exceeds the maxNodes budget',
        'warning',
        'performance',
      ),
    }
  }

  const sections = []
  for (let index = 0; index < indexCount; index += 1) {
    const offset = indexOffset + index * 16
    sections.push({
      tag: reversedTag(bytes, offset),
      offset: view.getUint32(offset + 4, true),
      repetitions: view.getUint32(offset + 8, true),
      version: view.getUint32(offset + 12, true),
    })
  }
  const boundaries = [...new Set([...sections.map(section => section.offset), indexOffset])]
    .filter(offset => offset >= headerBytes && offset <= bytes.byteLength)
    .sort((left, right) => left - right)
  let nodes = 0
  let decodedBytes = 0
  let present = false
  for (const section of sections) {
    const versions = RECORD_BYTES[section.tag]
    if (versions === undefined) continue
    present ||= section.tag === 'SEQS' || section.tag === 'STC_'
    const recordBytes = versions[section.version]
    if (recordBytes === undefined) {
      return {
        present,
        decodedBytes,
        issue: issue(
          'x3.m3/animation-version-unsupported',
          `${section.tag} version ${section.version} is not supported`,
        ),
      }
    }
    const end = boundaries.find(offset => offset > section.offset) ?? bytes.byteLength
    const available = Math.max(0, end - section.offset)
    const required = section.repetitions * recordBytes
    if (!Number.isSafeInteger(required) || required > available) {
      return {
        present,
        decodedBytes,
        issue: issue(
          `x3.m3/animation-${section.tag === 'SEQS' ? 'seqs' : 'stc'}-truncated`,
          `the ${section.tag} table needs ${required} bytes but only ${available} are available`,
        ),
      }
    }
    nodes += section.repetitions
    decodedBytes += required
  }
  if (nodes > budget.maxNodes) {
    return {
      present,
      decodedBytes,
      issue: issue(
        'x3.m3/animation-budget-exceeded',
        'the animation tables exceed the maxNodes budget',
        'warning',
        'performance',
      ),
    }
  }
  if (decodedBytes > budget.maxScalarBytes) {
    return {
      present,
      decodedBytes,
      issue: issue(
        'x3.m3/animation-budget-exceeded',
        'the animation tables exceed the maxScalarBytes budget',
        'warning',
        'performance',
      ),
    }
  }
  return { present, decodedBytes, issue: undefined }
}

function referencedString(sections, reference) {
  if (reference === null || typeof reference !== 'object') return { value: null, bytes: 0 }
  const entries = Number(reference.entries)
  const index = Number(reference.index)
  if (
    reference.__refTo !== 'CHAR' ||
    !Number.isSafeInteger(entries) ||
    entries <= 0 ||
    !Number.isSafeInteger(index) ||
    index < 0
  ) {
    return { value: null, bytes: 0 }
  }
  const section = sections.getSectionByReference(reference)
  if (
    section?.desc.history.name !== 'CHAR' ||
    !Array.isArray(section.content) ||
    entries > section.content.length
  ) {
    return { value: null, bytes: entries }
  }
  const values = section.content.slice(0, entries).map(value => Number(value))
  while (values.length > 0 && values.at(-1) === 0) values.pop()
  if (values.length === 0 || values.some(value => value < 0 || value > 255)) {
    return { value: null, bytes: entries }
  }
  try {
    return {
      value: new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(values)),
      bytes: entries,
    }
  } catch {
    return { value: null, bytes: entries }
  }
}

function referencedNumbers(sections, reference, expectedTag = 'U32_') {
  if (reference === null || typeof reference !== 'object') return null
  const entries = Number(reference.entries)
  if (!Number.isSafeInteger(entries) || entries < 0) return null
  if (entries === 0) return Object.freeze([])
  const section = sections.getSectionByReference(reference)
  if (section?.desc.history.name !== expectedTag || entries > section.content.length) return null
  const values = section.content.slice(0, entries).map(value => Number(value))
  return values.every(Number.isSafeInteger) ? Object.freeze(values) : null
}

function declaredRecords(sections, reference, expectedTag) {
  if (reference === null || typeof reference !== 'object') return null
  const entries = Number(reference.entries)
  if (!Number.isSafeInteger(entries) || entries < 0) return null
  const section = sections.getSectionByReference(reference)
  if (entries === 0) return Object.freeze([])
  if (section?.desc.history.name !== expectedTag || entries > section.content.length) return null
  return Object.freeze(section.content.slice(0, entries))
}

function animationIdOf(reference) {
  const id = Number(reference?.header?.id)
  return Number.isSafeInteger(id) && id >= 0 && id <= 0xffff_ffff ? id : null
}

function boneTargets(bones) {
  const targets = new Map()
  for (const [boneIndex, bone] of bones.entries()) {
    for (const channel of BONE_CHANNELS) {
      const animId = animationIdOf(bone[channel.field])
      if (animId === null) continue
      const list = targets.get(animId) ?? []
      list.push(Object.freeze({ target: `bone/${boneIndex}`, kind: channel.kind }))
      targets.set(animId, list)
    }
  }
  return targets
}

function stcChannels(sections, stc, stsRecords, targets, firstFrame, lastFrame) {
  const animIds = referencedNumbers(sections, stc.anim_ids)
  const animRefs = referencedNumbers(sections, stc.anim_refs)
  const stsIndex = Number(stc.sts_index)
  const sts = Number.isSafeInteger(stsIndex) && stsIndex >= 0 ? stsRecords[stsIndex] : undefined
  const membership = sts === undefined ? null : referencedNumbers(sections, sts.anim_ids)
  const channels = []
  const timelineFrames = []
  let unsupported = 0
  let rejectedTargets = 0
  if (animIds === null || animRefs === null || membership === null) {
    return {
      channels,
      timelineFrames,
      unsupported: Math.max(animIds?.length ?? 0, animRefs?.length ?? 0, 1),
      rejectedTargets,
    }
  }
  const members = new Set(membership)
  const count = Math.max(animIds.length, animRefs.length)
  for (let index = 0; index < count; index += 1) {
    const animId = animIds[index]
    const packed = animRefs[index]
    if (animId === undefined || packed === undefined || !members.has(animId)) {
      unsupported += 1
      continue
    }
    const sdField = SD_FIELDS[(packed >>> 16) & 0xffff]
    const sdIndex = packed & 0xffff
    const sdSection =
      sdField === undefined ? undefined : sections.getSectionByReference(stc[sdField])
    if (
      sdField === undefined ||
      sdSection?.desc.history.name !== sdField.toUpperCase() ||
      sdIndex >= sdSection.content.length
    ) {
      unsupported += 1
      continue
    }
    const sd = sdSection.content[sdIndex]
    const frames = referencedNumbers(sections, sd.frames, 'I32_')
    if (
      frames === null ||
      frames.length === 0 ||
      frames.some(frame => frame < firstFrame || frame > lastFrame)
    ) {
      unsupported += 1
      continue
    }
    timelineFrames.push(...frames)
    const target = targets.get(animId)
    if (target?.length !== 1) {
      unsupported += 1
      rejectedTargets += 1
      continue
    }
    channels.push(
      Object.freeze({
        target: target[0].target,
        kind: target[0].kind,
        firstTick: Math.min(...frames),
        lastTick: Math.max(...frames),
      }),
    )
  }
  return { channels, timelineFrames, unsupported, rejectedTargets }
}

/**
 * Decode SEQS/STG/STC/STS structure without claiming SD keyframes.
 *
 * M3 sequence bounds are integer millisecond ticks, but `ModelAnimationClip.frames` is a count, not
 * a duration. The publisher therefore counts distinct SD frame timestamps inside the SEQS bounds
 * and converts each channel's first/last timestamp to an index in that ordered set. It omits
 * frameRate because M3 sample cadence can be irregular. A BONE channel is published only when an
 * STC animation id resolves through STS membership, a valid SD container with timestamps, and
 * exactly one explicit BONE animation-reference header. SD key values are never read here.
 */
export async function decodeM3Animations(bytes, budget, signal) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  const preflight = animationIndexPreflight(bytes, budget)
  if (preflight.issue !== undefined) return emptyResult([preflight.issue], true)
  if (!preflight.present) return emptyResult()

  let sections
  try {
    sections = await M3SectionList.load(arrayBufferOf(bytes), await schemaText())
  } catch {
    return emptyResult(
      [
        issue(
          'x3.m3/animation-decode-failed',
          'the schema-backed parser refused the animation tables',
        ),
      ],
      true,
    )
  }
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')

  const sequences = declaredRecords(sections, sections.model?.sequences, 'SEQS')
  const stcs = declaredRecords(
    sections,
    sections.model?.sequence_transformation_collections,
    'STC_',
  )
  const stgs = declaredRecords(sections, sections.model?.sequence_transformation_groups, 'STG_')
  const stss = declaredRecords(sections, sections.model?.sts, 'STS_')
  const bones = declaredRecords(sections, sections.model?.bones, 'BONE')
  if (sequences === null || stcs === null || stgs === null || stss === null || bones === null) {
    return emptyResult(
      [
        issue(
          'x3.m3/animation-reference-refused',
          'MODL animation or BONE references do not address their declared section types and counts',
        ),
      ],
      true,
    )
  }
  const totalNodes = sequences.length + stcs.length + stgs.length + stss.length + bones.length
  if (totalNodes > budget.maxNodes) {
    return emptyResult(
      [
        issue(
          'x3.m3/animation-budget-exceeded',
          'referenced animation tables exceed the maxNodes budget',
          'warning',
          'performance',
        ),
      ],
      true,
      sequences.length,
    )
  }

  const targets = boneTargets(bones)
  const issues = []
  const clips = []
  const timelineContainers = []
  let decodedBytes = preflight.decodedBytes
  let supportedChannels = 0
  let unsupportedChannels = 0
  let invalidBounds = 0
  let rejectedTargets = 0
  for (const [sequenceIndex, sequence] of sequences.entries()) {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const start = Number(sequence.anim_ms_start)
    const end = Number(sequence.anim_ms_end)
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      !Number.isSafeInteger(end - start + 1)
    ) {
      invalidBounds += 1
      continue
    }
    const sequenceName = referencedString(sections, sequence.name)
    decodedBytes += sequenceName.bytes
    if (decodedBytes > budget.maxScalarBytes) {
      return emptyResult(
        [
          issue(
            'x3.m3/animation-budget-exceeded',
            'animation names exceed the maxScalarBytes budget',
            'warning',
            'performance',
          ),
        ],
        true,
        sequences.length,
      )
    }
    const stg = stgs[sequenceIndex]
    const stcIndices = stg === undefined ? null : referencedNumbers(sections, stg.stc_indices)
    const pendingChannels = []
    const timelineFrames = []
    let clipUnsupported = 0
    if (stcIndices === null) {
      clipUnsupported += 1
    } else {
      for (const stcIndex of stcIndices) {
        const stc = stcs[stcIndex]
        if (stc === undefined) {
          clipUnsupported += 1
          continue
        }
        const name = referencedString(sections, stc.name)
        decodedBytes += name.bytes
        const decoded = stcChannels(sections, stc, stss, targets, start, end)
        pendingChannels.push(...decoded.channels)
        timelineFrames.push(...decoded.timelineFrames)
        clipUnsupported += decoded.unsupported
        rejectedTargets += decoded.rejectedTargets
        timelineContainers.push(
          Object.freeze({
            index: stcIndex,
            name: name.value ?? `STC_${stcIndex}`,
            channels: decoded.channels.length,
            unsupportedChannels: decoded.unsupported,
            frames: new Set(decoded.timelineFrames).size,
          }),
        )
      }
    }
    const orderedFrames = [...new Set(timelineFrames)].sort((left, right) => left - right)
    decodedBytes += timelineFrames.length * 4
    if (orderedFrames.length === 0) {
      unsupportedChannels += clipUnsupported
      continue
    }
    const frameIndices = new Map(orderedFrames.map((frame, index) => [frame, index]))
    const clipChannels = pendingChannels.map(channel =>
      Object.freeze({
        target: channel.target,
        kind: channel.kind,
        firstFrame: frameIndices.get(channel.firstTick),
        lastFrame: frameIndices.get(channel.lastTick),
      }),
    )
    supportedChannels += clipChannels.length
    unsupportedChannels += clipUnsupported
    clips.push(
      Object.freeze({
        id: `m3-sequence-${sequenceIndex}`,
        name: sequenceName.value ?? `Sequence_${sequenceIndex}`,
        kind: orderedFrames.length > 1 ? 'animation' : 'rest-pose',
        provenance: 'direct',
        frames: orderedFrames.length,
        hierarchyId: 'm3/bone-table',
        channels: Object.freeze(clipChannels),
        ...(clipUnsupported === 0 ? {} : { unsupportedChannels: clipUnsupported }),
      }),
    )
  }
  if (decodedBytes > budget.maxScalarBytes) {
    return emptyResult(
      [
        issue(
          'x3.m3/animation-budget-exceeded',
          'animation metadata exceeds the maxScalarBytes budget',
          'warning',
          'performance',
        ),
      ],
      true,
      sequences.length,
    )
  }
  if (invalidBounds > 0) {
    issues.push(
      issue(
        'x3.m3/animation-bounds-refused',
        `${invalidBounds} SEQS record(s) have invalid millisecond bounds and were not published`,
      ),
    )
  }
  if (rejectedTargets > 0) {
    issues.push(
      issue(
        'x3.m3/animation-target-refused',
        `${rejectedTargets} STC channel(s) do not resolve to exactly one explicit BONE target`,
      ),
    )
  }
  if (unsupportedChannels > rejectedTargets) {
    issues.push(
      issue(
        'x3.m3/animation-channels-partial',
        `${unsupportedChannels} STC channel(s) are not represented by the live facet`,
        'information',
      ),
    )
  }
  return Object.freeze({
    declaredSequences: sequences.length,
    clips: Object.freeze(clips),
    timelineContainers: Object.freeze(timelineContainers),
    supportedChannels,
    unsupportedChannels,
    invalidBounds,
    rejectedTargets,
    decodedBytes,
    issues: Object.freeze(issues),
    fatal: false,
  })
}
