import { readFile } from 'node:fs/promises'
import { DOMParser } from '@xmldom/xmldom'
import { M3SectionList } from './native/binary/sections.js'
import { installM3PlatformAdapters } from './native/platform.js'

installM3PlatformAdapters({ DOMParser })

const MD34_BONE_BYTES = 160
const MD33_BONE_BYTES = 156
const KNOWN_BONE_FLAGS = Object.freeze([
  Object.freeze({ mask: 0x0001, name: 'inheritTranslation' }),
  Object.freeze({ mask: 0x0002, name: 'inheritScale' }),
  Object.freeze({ mask: 0x0004, name: 'inheritRotation' }),
  Object.freeze({ mask: 0x0010, name: 'billboard1' }),
  Object.freeze({ mask: 0x0040, name: 'billboard2' }),
  Object.freeze({ mask: 0x0100, name: 'project_2d' }),
  Object.freeze({ mask: 0x0200, name: 'animated' }),
  Object.freeze({ mask: 0x0400, name: 'ik' }),
  Object.freeze({ mask: 0x0800, name: 'skinned' }),
  Object.freeze({ mask: 0x2000, name: 'real' }),
  Object.freeze({ mask: 0x4000, name: 'batch1' }),
  Object.freeze({ mask: 0x8000, name: 'batch2' }),
])
const KNOWN_BONE_FLAG_MASK = KNOWN_BONE_FLAGS.reduce((mask, item) => mask | item.mask, 0) >>> 0

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

function emptyResult(issues = [], fatal = false) {
  return Object.freeze({
    bones: Object.freeze([]),
    bindings: Object.freeze([]),
    roots: 0,
    rejectedNames: 0,
    rejectedParentLinks: 0,
    unknownFlagRecords: 0,
    hierarchyComplete: false,
    decodedBytes: 0,
    issues: Object.freeze(issues),
    fatal,
  })
}

function boneIndexPreflight(bytes, budget) {
  const tag = reversedTag(bytes, 0)
  const headerBytes = tag === 'MD34' ? 24 : tag === 'MD33' ? 20 : 0
  if (headerBytes === 0 || bytes.byteLength < headerBytes) {
    return {
      entries: [],
      issue: issue('x3.m3/skeleton-container-invalid', 'the M3 header is invalid or truncated'),
    }
  }
  const view = viewOf(bytes)
  const indexOffset = view.getUint32(4, true)
  const indexCount = view.getUint32(8, true)
  const indexBytes = indexCount * 16
  if (
    !Number.isSafeInteger(indexBytes) ||
    indexCount > budget.maxNodes ||
    indexOffset < headerBytes ||
    indexOffset + indexBytes > bytes.byteLength
  ) {
    return {
      entries: [],
      issue: issue(
        'x3.m3/skeleton-budget-exceeded',
        'the M3 section index is invalid or exceeds the maxNodes budget',
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
  const entries = []
  let bones = 0
  let scalarBytes = 0
  for (const section of sections) {
    if (section.tag !== 'BONE') continue
    if (section.version !== 1) {
      return {
        entries: [],
        issue: issue(
          'x3.m3/skeleton-version-unsupported',
          `BONE version ${section.version} is not supported`,
        ),
      }
    }
    const recordBytes = tag === 'MD34' ? MD34_BONE_BYTES : MD33_BONE_BYTES
    const end = boundaries.find(offset => offset > section.offset) ?? bytes.byteLength
    const available = Math.max(0, end - section.offset)
    const required = section.repetitions * recordBytes
    if (!Number.isSafeInteger(required) || required > available) {
      return {
        entries: [],
        issue: issue(
          'x3.m3/skeleton-truncated',
          `the BONE table needs ${required} bytes but only ${available} are available`,
        ),
      }
    }
    bones += section.repetitions
    scalarBytes += required
    entries.push(section)
  }
  if (bones > budget.maxNodes || scalarBytes > budget.maxScalarBytes) {
    return {
      entries: [],
      issue: issue(
        'x3.m3/skeleton-budget-exceeded',
        'the BONE table exceeds the skeleton decode budget',
        'warning',
        'performance',
      ),
    }
  }
  return { entries, issue: undefined }
}

function charsFromReference(sections, reference) {
  if (reference === null || typeof reference !== 'object') {
    return { value: null, bytes: 0 }
  }
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
  const values = section.content.slice(0, entries).map(item => Number(item))
  while (values.length > 0 && values.at(-1) === 0) values.pop()
  if (values.length === 0 || values.some(value => value < 0 || value > 255)) {
    return { value: null, bytes: entries }
  }
  const chunks = []
  for (let offset = 0; offset < values.length; offset += 0x4000) {
    chunks.push(String.fromCharCode(...values.slice(offset, offset + 0x4000)))
  }
  return { value: chunks.join(''), bytes: entries }
}

function rejectedCycles(parents, rejected) {
  const cycleLinks = new Set()
  const complete = new Uint8Array(parents.length)
  for (let start = 0; start < parents.length; start += 1) {
    if (complete[start] !== 0 || rejected.has(start)) continue
    const path = []
    const positions = new Map()
    let current = start
    while (current >= 0 && complete[current] === 0 && !rejected.has(current)) {
      const seenAt = positions.get(current)
      if (seenAt !== undefined) {
        for (const index of path.slice(seenAt)) cycleLinks.add(index)
        break
      }
      positions.set(current, path.length)
      path.push(current)
      current = parents[current]
    }
    for (const index of path) complete[index] = 1
  }
  return cycleLinks
}

/**
 * Decode the BONE table addressed by `MODL.bones` without claiming STC animation or IREF pose data.
 *
 * This is Node-only for the same reason as geometry: the schema-backed parser loads structures.xml.
 * The returned bindings fit `model-skeleton-source@1`; parent links and raw flags are retained only
 * as decode evidence because that contract has no fields for either.
 */
export async function decodeM3Skeleton(bytes, budget, signal) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  const preflight = boneIndexPreflight(bytes, budget)
  if (preflight.issue !== undefined) return emptyResult([preflight.issue], true)
  if (preflight.entries.length === 0) return emptyResult()

  let sections
  try {
    sections = await M3SectionList.load(arrayBufferOf(bytes), await schemaText())
  } catch {
    return emptyResult(
      [issue('x3.m3/skeleton-decode-failed', 'the schema-backed parser refused the BONE table')],
      true,
    )
  }
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')

  const modelReference = sections.model?.bones
  const boneSection = sections.getSectionByReference(modelReference)
  if (boneSection?.desc.history.name !== 'BONE') {
    return emptyResult([
      issue('x3.m3/skeleton-reference-refused', 'MODL.bones does not address a BONE table'),
    ])
  }
  const declared = Number(modelReference?.entries)
  if (
    !Number.isSafeInteger(declared) ||
    declared < 0 ||
    declared > boneSection.content.length ||
    declared > budget.maxNodes
  ) {
    return emptyResult(
      [
        issue(
          'x3.m3/skeleton-budget-exceeded',
          'MODL.bones declares an invalid count or exceeds the maxNodes budget',
          'warning',
          'performance',
        ),
      ],
      true,
    )
  }
  const sourceBones = boneSection.content.slice(0, declared)
  const bones = []
  let scalarBytes = preflight.entries.reduce(
    (total, section) =>
      total + section.repetitions * (sections.mdVersion === 34 ? MD34_BONE_BYTES : MD33_BONE_BYTES),
    0,
  )
  let rejectedNames = 0
  let unknownFlagRecords = 0
  for (const [index, bone] of sourceBones.entries()) {
    const name = charsFromReference(sections, bone.name)
    scalarBytes += name.bytes
    if (scalarBytes > budget.maxScalarBytes) {
      return emptyResult(
        [
          issue(
            'x3.m3/skeleton-budget-exceeded',
            'BONE names exceed the maxScalarBytes budget',
            'warning',
            'performance',
          ),
        ],
        true,
      )
    }
    if (name.value === null) rejectedNames += 1
    const flags = Number(bone.flags ?? 0) >>> 0
    const unknownFlagMask = (flags & ~KNOWN_BONE_FLAG_MASK) >>> 0
    if (unknownFlagMask !== 0) unknownFlagRecords += 1
    bones.push(
      Object.freeze({
        index,
        name: name.value,
        parentIndex: Number(bone.parent ?? -1),
        flags,
        flagNames: Object.freeze(
          KNOWN_BONE_FLAGS.filter(item => (flags & item.mask) !== 0).map(item => item.name),
        ),
        unknownFlagMask,
      }),
    )
  }

  const parents = bones.map(bone => bone.parentIndex)
  const rejectedParents = new Set()
  for (const bone of bones) {
    if (
      !Number.isSafeInteger(bone.parentIndex) ||
      bone.parentIndex < -1 ||
      bone.parentIndex >= bones.length ||
      bone.parentIndex === bone.index
    ) {
      rejectedParents.add(bone.index)
    }
  }
  const cycles = rejectedCycles(parents, rejectedParents)
  for (const index of cycles) rejectedParents.add(index)
  const hierarchyComplete = rejectedParents.size === 0
  const hierarchyId = 'm3/bone-table'
  const bindings = bones.map(bone =>
    Object.freeze({
      partId: `bone/${bone.index}`,
      boneIndex: bone.index,
      boneName: bone.name,
      provenance: bone.name === null ? 'absent' : 'direct',
      ...(hierarchyComplete ? { hierarchyId } : {}),
    }),
  )
  const issues = []
  if (rejectedNames > 0) {
    issues.push(
      issue(
        'x3.m3/skeleton-name-refused',
        `${rejectedNames} BONE name reference(s) do not address their declared CHAR data`,
      ),
    )
  }
  if (rejectedParents.size > 0) {
    issues.push(
      issue(
        'x3.m3/skeleton-parent-refused',
        `${rejectedParents.size} BONE parent link(s) are out of range, self-referential, or cyclic`,
      ),
    )
  }
  if (unknownFlagRecords > 0) {
    issues.push(
      issue(
        'x3.m3/skeleton-flags-partial',
        `${unknownFlagRecords} BONE record(s) use flag bits outside the schema's named mask`,
        'information',
      ),
    )
  }
  return Object.freeze({
    bones: Object.freeze(bones),
    bindings: Object.freeze(bindings),
    roots: bones.filter(bone => bone.parentIndex === -1).length,
    rejectedNames,
    rejectedParentLinks: rejectedParents.size,
    unknownFlagRecords,
    hierarchyComplete,
    decodedBytes: scalarBytes,
    issues: Object.freeze(issues),
    fatal: false,
  })
}
