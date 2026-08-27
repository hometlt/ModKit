import { readFile } from 'node:fs/promises'
import { DOMParser } from '@xmldom/xmldom'
import { M3SectionList } from './native/binary/sections.js'
import { installM3PlatformAdapters } from './native/platform.js'

installM3PlatformAdapters({ DOMParser })

const RECORD_BYTES = Object.freeze({
  MATM: Object.freeze({ 0: 8 }),
  MAT_: Object.freeze({ 15: 268, 16: 280, 17: 280, 18: 280, 19: 340, 20: 352 }),
  LAYR: Object.freeze({ 20: 356, 21: 356, 22: 356, 23: 428, 24: 436, 25: 468, 26: 464 }),
  DIV_: Object.freeze({ 2: 52 }),
  BAT_: Object.freeze({ 1: 14 }),
})

const MATERIAL_TYPES = Object.freeze({
  1: 'standard',
  2: 'displacement',
  3: 'composite',
  4: 'terrain',
  5: 'volume',
  6: 'volume-noise',
  7: 'creep',
  8: 'hair',
  9: 'splat-terrain-bake',
  10: 'reflection',
  11: 'lens-flare',
  12: 'buffer',
})

const BLEND_MODES = Object.freeze({
  0: 'opaque',
  1: 'blend',
  2: 'additive',
  3: 'add-alpha',
  4: 'modulate',
  5: 'modulate-2x',
})

const STANDARD_FLAGS = Object.freeze([
  Object.freeze({ mask: 0x0000_0001, name: 'vertex-color' }),
  Object.freeze({ mask: 0x0000_0002, name: 'vertex-alpha' }),
  Object.freeze({ mask: 0x0000_0004, name: 'unfogged' }),
  Object.freeze({ mask: 0x0000_0008, name: 'two-sided' }),
  Object.freeze({ mask: 0x0000_0010, name: 'unshaded' }),
  Object.freeze({ mask: 0x0000_0020, name: 'no-shadows-cast' }),
  Object.freeze({ mask: 0x0000_0040, name: 'no-hittest' }),
  Object.freeze({ mask: 0x0000_0080, name: 'no-shadows-receive' }),
  Object.freeze({ mask: 0x0000_0100, name: 'depth-prepass' }),
  Object.freeze({ mask: 0x0000_0200, name: 'terrain-hdr' }),
  Object.freeze({ mask: 0x0000_0400, name: 'unknown-0x400' }),
  Object.freeze({ mask: 0x0000_0800, name: 'simulate-roughness' }),
  Object.freeze({ mask: 0x0000_1000, name: 'pixel-forward-lighting' }),
  Object.freeze({ mask: 0x0000_2000, name: 'depth-fog' }),
  Object.freeze({ mask: 0x0000_4000, name: 'transparent-shadows' }),
  Object.freeze({ mask: 0x0000_8000, name: 'decal-lighting' }),
  Object.freeze({ mask: 0x0001_0000, name: 'transparent-depth-effects' }),
  Object.freeze({ mask: 0x0002_0000, name: 'transparent-local-lights' }),
  Object.freeze({ mask: 0x0004_0000, name: 'disable-soft' }),
  Object.freeze({ mask: 0x0008_0000, name: 'double-lambert' }),
  Object.freeze({ mask: 0x0010_0000, name: 'hair-layer-sorting' }),
  Object.freeze({ mask: 0x0020_0000, name: 'accept-splats' }),
  Object.freeze({ mask: 0x0040_0000, name: 'decal-low-required' }),
  Object.freeze({ mask: 0x0080_0000, name: 'emissive-low-required' }),
  Object.freeze({ mask: 0x0100_0000, name: 'specular-low-required' }),
  Object.freeze({ mask: 0x0200_0000, name: 'accept-splats-only' }),
  Object.freeze({ mask: 0x0400_0000, name: 'background-object' }),
  Object.freeze({ mask: 0x0800_0000, name: 'unknown-0x08000000' }),
  Object.freeze({ mask: 0x1000_0000, name: 'depth-prepass-low-required' }),
  Object.freeze({ mask: 0x2000_0000, name: 'no-highlighting' }),
  Object.freeze({ mask: 0x4000_0000, name: 'clamp-output' }),
  Object.freeze({ mask: 0x8000_0000, name: 'geometry-visible' }),
])
const STANDARD_FLAG_MASK = STANDARD_FLAGS.reduce((mask, item) => mask | item.mask, 0) >>> 0

const LAYER_FLAGS = Object.freeze([
  Object.freeze({ mask: 0x0000_0004, name: 'uv-wrap-x' }),
  Object.freeze({ mask: 0x0000_0008, name: 'uv-wrap-y' }),
  Object.freeze({ mask: 0x0000_0010, name: 'color-invert' }),
  Object.freeze({ mask: 0x0000_0020, name: 'color-clamp' }),
  Object.freeze({ mask: 0x0000_0040, name: 'color-add' }),
  Object.freeze({ mask: 0x0000_0080, name: 'color-multiply' }),
  Object.freeze({ mask: 0x0000_0100, name: 'particle-uv-flipbook' }),
  Object.freeze({ mask: 0x0000_0200, name: 'video' }),
  Object.freeze({ mask: 0x0000_0400, name: 'color' }),
  Object.freeze({ mask: 0x0000_2000, name: 'unknown-0x2000' }),
  Object.freeze({ mask: 0x0000_4000, name: 'fresnel-transform' }),
  Object.freeze({ mask: 0x0000_8000, name: 'fresnel-normalize' }),
  Object.freeze({ mask: 0x0001_0000, name: 'fresnel-local-transform' }),
  Object.freeze({ mask: 0x0002_0000, name: 'fresnel-do-not-mirror' }),
])
const LAYER_FLAG_MASK = LAYER_FLAGS.reduce((mask, item) => mask | item.mask, 0) >>> 0

const STANDARD_LAYERS = Object.freeze([
  Object.freeze({ field: 'layer_diff', slot: 'diffuse' }),
  Object.freeze({ field: 'layer_decal', slot: 'decal' }),
  Object.freeze({ field: 'layer_spec', slot: 'specular' }),
  Object.freeze({ field: 'layer_gloss', slot: 'gloss' }),
  Object.freeze({ field: 'layer_emis1', slot: 'emissive-1' }),
  Object.freeze({ field: 'layer_emis2', slot: 'emissive-2' }),
  Object.freeze({ field: 'layer_envi', slot: 'environment' }),
  Object.freeze({ field: 'layer_envi_mask', slot: 'environment-mask' }),
  Object.freeze({ field: 'layer_alpha1', slot: 'alpha-1' }),
  Object.freeze({ field: 'layer_alpha2', slot: 'alpha-2' }),
  Object.freeze({ field: 'layer_norm', slot: 'normal' }),
  Object.freeze({ field: 'layer_height', slot: 'height' }),
  Object.freeze({ field: 'layer_light', slot: 'light' }),
  Object.freeze({ field: 'layer_ao', slot: 'ambient-occlusion' }),
  Object.freeze({ field: 'layer_norm_blend1_mask', slot: 'normal-blend-1-mask' }),
  Object.freeze({ field: 'layer_norm_blend2_mask', slot: 'normal-blend-2-mask' }),
  Object.freeze({ field: 'layer_norm_blend1', slot: 'normal-blend-1' }),
  Object.freeze({ field: 'layer_norm_blend2', slot: 'normal-blend-2' }),
])

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
    materials: Object.freeze([]),
    primitiveBindings: Object.freeze([]),
    standardMaterials: 0,
    exoticMaterials: 0,
    exoticTypes: Object.freeze([]),
    decodedLayers: 0,
    linkedLayers: 0,
    rejectedNames: 0,
    rejectedLayerReferences: 0,
    unresolvedLayerResources: 0,
    rejectedMaterialReferences: 0,
    ambiguousPrimitiveBindings: 0,
    unsupportedBlendModes: 0,
    unknownFlagRecords: 0,
    decodedBytes: 0,
    issues: Object.freeze(issues),
    fatal,
  })
}

function materialIndexPreflight(bytes, budget) {
  const tag = reversedTag(bytes, 0)
  const headerBytes = tag === 'MD34' ? 24 : tag === 'MD33' ? 20 : 0
  if (headerBytes === 0 || bytes.byteLength < headerBytes) {
    return {
      present: false,
      decodedBytes: 0,
      issue: issue('x3.m3/material-container-invalid', 'the M3 header is invalid or truncated'),
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
        'x3.m3/material-container-invalid',
        'the M3 section index is invalid or outside the source',
      ),
    }
  }
  if (indexCount > budget.maxNodes) {
    return {
      present: false,
      decodedBytes: 0,
      issue: issue(
        'x3.m3/material-budget-exceeded',
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
    present ||= section.tag === 'MATM' || section.tag === 'MAT_'
    const recordBytes = versions[section.version]
    if (recordBytes === undefined) {
      return {
        present,
        decodedBytes,
        issue: issue(
          'x3.m3/material-version-unsupported',
          `${section.tag} version ${section.version} is not supported`,
        ),
      }
    }
    const end = boundaries.find(offset => offset > section.offset) ?? bytes.byteLength
    const available = Math.max(0, end - section.offset)
    const required = section.repetitions * recordBytes
    if (!Number.isSafeInteger(required) || required > available) {
      const part = section.tag.toLowerCase().replaceAll('_', '')
      return {
        present,
        decodedBytes,
        issue: issue(
          `x3.m3/material-${part}-truncated`,
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
        'x3.m3/material-budget-exceeded',
        'the material tables exceed the maxNodes budget',
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
        'x3.m3/material-budget-exceeded',
        'the material tables exceed the maxScalarBytes budget',
        'warning',
        'performance',
      ),
    }
  }
  return { present, decodedBytes, issue: undefined }
}

function referencedString(sections, reference) {
  if (reference === null || typeof reference !== 'object') {
    return { state: 'invalid', value: null, bytes: 0 }
  }
  const entries = Number(reference.entries)
  const index = Number(reference.index)
  if (!Number.isSafeInteger(entries) || entries < 0 || !Number.isSafeInteger(index) || index < 0) {
    return { state: 'invalid', value: null, bytes: 0 }
  }
  if (entries === 0) return { state: 'absent', value: null, bytes: 0 }
  const section = sections.getSectionByReference(reference)
  if (
    reference.__refTo !== 'CHAR' ||
    section?.desc.history.name !== 'CHAR' ||
    !Array.isArray(section.content) ||
    entries > section.content.length
  ) {
    return { state: 'invalid', value: null, bytes: entries }
  }
  const values = section.content.slice(0, entries).map(item => Number(item))
  while (values.length > 0 && values.at(-1) === 0) values.pop()
  if (values.some(value => value < 0 || value > 255)) {
    return { state: 'invalid', value: null, bytes: entries }
  }
  const chunks = []
  for (let offset = 0; offset < values.length; offset += 0x4000) {
    chunks.push(String.fromCharCode(...values.slice(offset, offset + 0x4000)))
  }
  return { state: values.length === 0 ? 'absent' : 'value', value: chunks.join(''), bytes: entries }
}

function declaredRecords(sections, reference, expectedTag) {
  if (reference === null || typeof reference !== 'object') return null
  const entries = Number(reference.entries)
  if (!Number.isSafeInteger(entries) || entries < 0) return null
  if (entries === 0) return Object.freeze([])
  const section = sections.getSectionByReference(reference)
  if (section?.desc.history.name !== expectedTag || entries > section.content.length) return null
  return Object.freeze(section.content.slice(0, entries))
}

function resourceLookup(resourceIds) {
  const lookup = new Map()
  for (const id of resourceIds) lookup.set(id.toLowerCase(), id)
  return lookup
}

function normalizedResourceKey(value) {
  const normalized = value.trim().split(String.fromCharCode(92)).join('/')
  if (
    normalized.length === 0 ||
    /^[A-Za-z]:|^[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$)|^[a-z][a-z0-9+.-]*:/u.test(normalized)
  ) {
    return null
  }
  return normalized.toLowerCase()
}

function namedBits(value, definitions) {
  return Object.freeze(definitions.filter(item => (value & item.mask) !== 0).map(item => item.name))
}

function materialTypeName(type) {
  return MATERIAL_TYPES[type] ?? `unknown-${type}`
}

function primitiveBindingsOf(sections, materials) {
  const materialByReference = new Map(
    materials.map(material => [material.referenceIndex, material]),
  )
  const divisions = declaredRecords(sections, sections.model?.divisions, 'DIV_')
  if (divisions === null) {
    return { bindings: [], rejected: 1, ambiguous: 0 }
  }
  const bindings = []
  let rejected = 0
  let ambiguous = 0
  let primitiveOffset = 0
  for (const division of divisions) {
    const batches = declaredRecords(sections, division.batches, 'BAT_')
    const regions = declaredRecords(sections, division.regions, 'REGN')
    if (batches === null || regions === null) {
      rejected += 1
      continue
    }
    const byRegion = new Map()
    for (const batch of batches) {
      const regionIndex = Number(batch.region_index)
      const materialIndex = Number(batch.material_reference_index)
      if (
        !Number.isSafeInteger(regionIndex) ||
        regionIndex < 0 ||
        regionIndex >= regions.length ||
        !Number.isSafeInteger(materialIndex) ||
        materialIndex < 0 ||
        !materialByReference.has(materialIndex)
      ) {
        rejected += 1
        continue
      }
      const candidates = byRegion.get(regionIndex) ?? new Set()
      candidates.add(materialIndex)
      byRegion.set(regionIndex, candidates)
    }
    for (const [regionIndex, candidates] of byRegion) {
      if (candidates.size !== 1) {
        ambiguous += 1
        continue
      }
      const materialIndex = [...candidates][0]
      bindings.push(
        Object.freeze({
          primitiveId: `mesh-0-primitive-${primitiveOffset + regionIndex}`,
          materialId: materialByReference.get(materialIndex).id,
        }),
      )
    }
    primitiveOffset += regions.length
  }
  bindings.sort((left, right) => left.primitiveId.localeCompare(right.primitiveId))
  return { bindings, rejected, ambiguous }
}

/**
 * Decode M3 material identity, standard-material metadata, layer slots and BAT → primitive links.
 *
 * Layer texture strings are used only to join against the authoritative resource ids supplied by
 * `model-resource-refs-source`; returned layers retain that foreign key and never duplicate a path.
 */
export async function decodeM3Materials(bytes, budget, signal, resourceIds = []) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  const preflight = materialIndexPreflight(bytes, budget)
  if (preflight.issue !== undefined) return emptyResult([preflight.issue], true)
  if (!preflight.present) return emptyResult()

  let sections
  try {
    sections = await M3SectionList.load(arrayBufferOf(bytes), await schemaText())
  } catch {
    return emptyResult(
      [
        issue(
          'x3.m3/material-decode-failed',
          'the schema-backed parser refused the material tables',
        ),
      ],
      true,
    )
  }
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')

  const materialReferences = declaredRecords(sections, sections.model?.material_references, 'MATM')
  const standardRecords = declaredRecords(sections, sections.model?.materials_standard, 'MAT_')
  if (materialReferences === null || standardRecords === null) {
    return emptyResult(
      [
        issue(
          'x3.m3/material-reference-refused',
          'MODL material references do not address their declared MATM and MAT_ tables',
        ),
      ],
      true,
    )
  }
  if (materialReferences.length + standardRecords.length > budget.maxNodes) {
    return emptyResult(
      [
        issue(
          'x3.m3/material-budget-exceeded',
          'referenced material tables exceed the maxNodes budget',
          'warning',
          'performance',
        ),
      ],
      true,
    )
  }

  const resources = resourceLookup(resourceIds)
  const materials = []
  const exoticTypes = new Set()
  let decodedBytes = preflight.decodedBytes
  let decodedLayers = 0
  let linkedLayers = 0
  let rejectedNames = 0
  let rejectedLayerReferences = 0
  let unresolvedLayerResources = 0
  let rejectedMaterialReferences = 0
  let unsupportedBlendModes = 0
  let unknownFlagRecords = 0
  for (const [materialReferenceIndex, reference] of materialReferences.entries()) {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const type = Number(reference.type)
    const sourceIndex = Number(reference.material_index)
    const typeName = materialTypeName(type)
    if (
      !Number.isSafeInteger(type) ||
      type < 0 ||
      !Number.isSafeInteger(sourceIndex) ||
      sourceIndex < 0
    ) {
      rejectedMaterialReferences += 1
      continue
    }
    if (type !== 1) {
      exoticTypes.add(typeName)
      materials.push(
        Object.freeze({
          id: `material-${materialReferenceIndex}`,
          referenceIndex: materialReferenceIndex,
          name: `M3 ${typeName} material ${sourceIndex}`,
          type,
          typeName,
          sourceIndex,
          layers: Object.freeze([]),
        }),
      )
      continue
    }
    const standard = standardRecords[sourceIndex]
    if (standard === undefined) {
      rejectedMaterialReferences += 1
      continue
    }
    const decodedName = referencedString(sections, standard.name)
    decodedBytes += decodedName.bytes
    if (decodedName.state === 'invalid') rejectedNames += 1
    const layers = []
    for (const definition of STANDARD_LAYERS) {
      const layerReference = standard[definition.field]
      // Older MAT_ versions do not carry the later gloss/normal-blend fields at all. Their
      // absence is a versioned schema fact, not a malformed reference.
      if (layerReference === undefined) continue
      const records = declaredRecords(sections, layerReference, 'LAYR')
      if (records === null) {
        rejectedLayerReferences += 1
        continue
      }
      for (const layer of records) {
        decodedLayers += 1
        const bitmap = referencedString(sections, layer.color_bitmap)
        decodedBytes += bitmap.bytes
        let resourceId
        if (bitmap.state === 'invalid') {
          rejectedLayerReferences += 1
        } else if (bitmap.state === 'value') {
          const key = normalizedResourceKey(bitmap.value)
          resourceId = key === null ? undefined : resources.get(key)
          if (resourceId === undefined) unresolvedLayerResources += 1
          else linkedLayers += 1
        }
        const flags = Number(layer.flags ?? 0) >>> 0
        const unknownFlagMask = (flags & ~LAYER_FLAG_MASK) >>> 0
        if (unknownFlagMask !== 0) unknownFlagRecords += 1
        layers.push(
          Object.freeze({
            slot: definition.slot,
            flags,
            flagNames: namedBits(flags, LAYER_FLAGS),
            unknownFlagMask,
            uvSource: Number(layer.uv_source ?? 0),
            colorChannels: Number(layer.color_channels ?? 0) >>> 0,
            ...(resourceId === undefined ? {} : { resourceId }),
          }),
        )
      }
    }
    const flags = Number(standard.flags ?? 0) >>> 0
    const unknownFlagMask = (flags & ~STANDARD_FLAG_MASK) >>> 0
    if (unknownFlagMask !== 0) unknownFlagRecords += 1
    const blendMode = Number(standard.blend_mode)
    const blendModeName = BLEND_MODES[blendMode]
    if (blendModeName === undefined) unsupportedBlendModes += 1
    materials.push(
      Object.freeze({
        id: `material-${materialReferenceIndex}`,
        referenceIndex: materialReferenceIndex,
        ...(decodedName.value === null ? {} : { name: decodedName.value }),
        type,
        typeName,
        sourceIndex,
        flags,
        flagNames: namedBits(flags, STANDARD_FLAGS),
        unknownFlagMask,
        blendMode,
        ...(blendModeName === undefined ? {} : { blendModeName }),
        priority: Number(standard.priority ?? 0),
        layers: Object.freeze(layers),
      }),
    )
  }

  if (decodedBytes > budget.maxScalarBytes) {
    return emptyResult(
      [
        issue(
          'x3.m3/material-budget-exceeded',
          'material names and layer resource joins exceed the maxScalarBytes budget',
          'warning',
          'performance',
        ),
      ],
      true,
    )
  }
  const primitiveBindings = primitiveBindingsOf(sections, materials)
  rejectedMaterialReferences += primitiveBindings.rejected
  const issues = []
  if (rejectedNames > 0) {
    issues.push(
      issue(
        'x3.m3/material-name-refused',
        `${rejectedNames} MAT_ name reference(s) do not address their declared CHAR data`,
      ),
    )
  }
  if (rejectedLayerReferences > 0) {
    issues.push(
      issue(
        'x3.m3/material-layer-refused',
        `${rejectedLayerReferences} MAT_/LAYR reference(s) do not address their declared data`,
      ),
    )
  }
  if (unresolvedLayerResources > 0) {
    issues.push(
      issue(
        'x3.m3/material-resource-unresolved',
        `${unresolvedLayerResources} non-empty LAYR texture reference(s) have no published resource id`,
        'information',
      ),
    )
  }
  if (rejectedMaterialReferences > 0) {
    issues.push(
      issue(
        'x3.m3/material-binding-refused',
        `${rejectedMaterialReferences} MATM or BAT_ material reference(s) are invalid`,
      ),
    )
  }
  if (primitiveBindings.ambiguous > 0) {
    issues.push(
      issue(
        'x3.m3/material-binding-ambiguous',
        `${primitiveBindings.ambiguous} region(s) use more than one material and were not bound to a primitive`,
      ),
    )
  }
  if (exoticTypes.size > 0) {
    issues.push(
      issue(
        'x3.m3/material-types-partial',
        `material parameters for ${[...exoticTypes].join(', ')} are not decoded`,
        'information',
      ),
    )
  }
  if (unsupportedBlendModes > 0 || unknownFlagRecords > 0) {
    issues.push(
      issue(
        'x3.m3/material-semantics-partial',
        `${unsupportedBlendModes} blend mode(s) and ${unknownFlagRecords} flag record(s) lack named semantics`,
        'information',
      ),
    )
  }
  return Object.freeze({
    materials: Object.freeze(materials),
    primitiveBindings: Object.freeze(primitiveBindings.bindings),
    standardMaterials: materialReferences.filter(reference => Number(reference.type) === 1).length,
    exoticMaterials: materialReferences.filter(reference => Number(reference.type) !== 1).length,
    exoticTypes: Object.freeze([...exoticTypes].sort()),
    decodedLayers,
    linkedLayers,
    rejectedNames,
    rejectedLayerReferences,
    unresolvedLayerResources,
    rejectedMaterialReferences,
    ambiguousPrimitiveBindings: primitiveBindings.ambiguous,
    unsupportedBlendModes,
    unknownFlagRecords,
    decodedBytes,
    issues: Object.freeze(issues),
    fatal: false,
  })
}
