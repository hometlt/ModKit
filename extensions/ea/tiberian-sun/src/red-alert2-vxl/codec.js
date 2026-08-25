// Portable VXL reader. It validates section directories and tailers, decodes bounded packed spans,
// and emits an occlusion-aware surface mesh.
//
// Section transforms over time live in a sibling `.hva`, never in the `.vxl` itself, so this codec
// *declares* that companion and reads whatever the host bound — it does not look for it. PAL/VPL
// remain declared debt: see `unsupportedFeatures`.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'
import { bindSections, hvaMatrix, parseHva } from './hva.js'

const ID = 'org.modkitx/red-alert2-vxl'
const MAGIC = 'Voxel Animation'
const HEADER_BYTES = 802
const SECTION_HEADER_BYTES = 28
const SECTION_TAILER_BYTES = 92
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes, offset, length) {
  if (offset < 0 || length < 0 || offset > bytes.byteLength || length > bytes.byteLength - offset)
    throw new RangeError('VXL string is outside the file')
  let result = ''
  for (let index = 0; index < length; index += 1) {
    const value = bytes[offset + index] ?? 0
    if (value === 0) break
    result += String.fromCharCode(value)
  }
  return result
}

function signature(bytes) {
  return ascii(bytes, 0, Math.min(16, bytes.byteLength)).startsWith(MAGIC)
}

function rangeWithin(offset, length, start, end) {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= start &&
    length >= 0 &&
    offset + length >= offset &&
    offset + length <= end
  )
}

function decodeVoxels(bytes, bodyOffset, bodyEnd, section, budget, state) {
  const { x, y, z } = section.dimensions
  if (x === 0 || y === 0 || z === 0) return Object.freeze([])
  const spanCount = x * y
  const tableBytes = spanCount * 4
  const startOffset = bodyOffset + section.spanOffsets.start
  const endOffset = bodyOffset + section.spanOffsets.end
  const dataOffset = bodyOffset + section.spanOffsets.data
  if (
    !rangeWithin(startOffset, tableBytes, bodyOffset, bodyEnd) ||
    !rangeWithin(endOffset, tableBytes, bodyOffset, bodyEnd) ||
    !rangeWithin(dataOffset, 0, bodyOffset, bodyEnd)
  ) {
    throw new RangeError('VXL span tables are outside the body')
  }
  const data = viewOf(bytes)
  const voxels = []
  for (let columnY = 0; columnY < y; columnY += 1) {
    for (let columnX = 0; columnX < x; columnX += 1) {
      const column = columnY * x + columnX
      const start = data.getInt32(startOffset + column * 4, true)
      const end = data.getInt32(endOffset + column * 4, true)
      if (start < 0 || end < 0) continue
      if (end < start) throw new TypeError('VXL span end precedes its start')
      let cursor = dataOffset + start
      const limit = dataOffset + end + 1
      if (!rangeWithin(cursor, limit - cursor, dataOffset, bodyEnd))
        throw new RangeError('VXL span data is outside the body')
      let voxelZ = 0
      while (cursor < limit && voxelZ < z) {
        if (cursor + 2 > limit) throw new TypeError('VXL span header is truncated')
        const skip = bytes[cursor] ?? 0
        const count = bytes[cursor + 1] ?? 0
        cursor += 2
        voxelZ += skip
        if (count === 0) {
          if (cursor < limit) cursor += 1
          if (skip === 0) break
          continue
        }
        if (voxelZ >= z || cursor + count * 2 + 1 > limit)
          throw new TypeError('VXL span run is truncated or exceeds the section')
        for (let voxel = 0; voxel < count; voxel += 1) {
          voxels.push(
            Object.freeze({
              x: columnX,
              y: columnY,
              z: voxelZ,
              colorIndex: bytes[cursor] ?? 0,
              normalIndex: bytes[cursor + 1] ?? 0,
            }),
          )
          cursor += 2
          voxelZ += 1
          state.voxels += 1
          if (state.voxels > budget.maxNodes) throw new RangeError('VXL voxels exceed maxNodes')
        }
        const repeatedCount = bytes[cursor] ?? 0
        cursor += 1
        if (repeatedCount !== count) throw new TypeError('VXL span counts do not match')
      }
    }
  }
  return Object.freeze(voxels)
}

function parse(bytes, budget) {
  if (!signature(bytes)) throw new TypeError('VXL magic is missing')
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('VXL header is truncated')
  const view = viewOf(bytes)
  const header = Object.freeze({
    fileType: ascii(bytes, 0, 16),
    palettes: view.getInt32(16, true),
    sections: view.getInt32(20, true),
    repeatedSections: view.getInt32(24, true),
    bodyBytes: view.getInt32(28, true),
    startPaletteRemap: bytes[32] ?? 0,
    endPaletteRemap: bytes[33] ?? 0,
  })
  if (header.sections <= 0 || header.sections > budget.maxNodes)
    throw new RangeError('VXL sections exceed maxNodes or are invalid')
  if (header.repeatedSections !== header.sections)
    throw new TypeError('VXL repeated section count does not match')
  if (header.bodyBytes < 0) throw new TypeError('VXL body size is negative')
  const sectionHeaders = HEADER_BYTES
  const bodyOffset = sectionHeaders + header.sections * SECTION_HEADER_BYTES
  const tailersOffset = bodyOffset + header.bodyBytes
  const expected = tailersOffset + header.sections * SECTION_TAILER_BYTES
  if (!Number.isSafeInteger(expected) || expected > bytes.byteLength)
    throw new TypeError('VXL section directory, body, or tailers are truncated')
  if (expected !== bytes.byteLength)
    throw new TypeError('VXL trailing data is not described by the header')
  const sections = []
  const state = { voxels: 0 }
  for (let index = 0; index < header.sections; index += 1) {
    const sectionOffset = sectionHeaders + index * SECTION_HEADER_BYTES
    const tailerOffset = tailersOffset + index * SECTION_TAILER_BYTES
    const dimensions = Object.freeze({
      x: bytes[tailerOffset + 88] ?? 0,
      y: bytes[tailerOffset + 89] ?? 0,
      z: bytes[tailerOffset + 90] ?? 0,
    })
    const min = Object.freeze([
      view.getFloat32(tailerOffset + 64, true),
      view.getFloat32(tailerOffset + 68, true),
      view.getFloat32(tailerOffset + 72, true),
    ])
    const max = Object.freeze([
      view.getFloat32(tailerOffset + 76, true),
      view.getFloat32(tailerOffset + 80, true),
      view.getFloat32(tailerOffset + 84, true),
    ])
    if (![...min, ...max].every(Number.isFinite))
      throw new TypeError('VXL bounds contain non-finite values')
    const spanStart = view.getInt32(tailerOffset, true)
    const spanEnd = view.getInt32(tailerOffset + 4, true)
    const spanData = view.getInt32(tailerOffset + 8, true)
    if ([spanStart, spanEnd, spanData].some(value => value < 0 || value > header.bodyBytes))
      throw new RangeError('VXL section span offset is outside the body')
    const section = {
      id: String(index),
      name: ascii(bytes, sectionOffset, 16) || `Section_${index}`,
      number: view.getInt32(sectionOffset + 16, true),
      dimensions,
      min,
      max,
      normalsType: bytes[tailerOffset + 91] ?? 0,
      spanOffsets: Object.freeze({ start: spanStart, end: spanEnd, data: spanData }),
      transform: Object.freeze(
        Array.from({ length: 12 }, (_, component) =>
          view.getFloat32(tailerOffset + 16 + component * 4, true),
        ),
      ),
    }
    section.voxels = decodeVoxels(bytes, bodyOffset, tailersOffset, section, budget, state)
    sections.push(Object.freeze(section))
  }
  return Object.freeze({ header, sections: Object.freeze(sections), bodyOffset, tailersOffset })
}

function axisMetrics(min, max, size) {
  return Number.isFinite(min) && Number.isFinite(max) && max > min
    ? { min, step: (max - min) / size }
    : { min: -size / 2, step: 1 }
}

function voxelKey(x, y, z) {
  return `${x},${y},${z}`
}

function toUvm([x, y, z]) {
  return [y, z, x]
}

const FACES = Object.freeze([
  {
    delta: [1, 0, 0],
    normal: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    delta: [-1, 0, 0],
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    delta: [0, 1, 0],
    normal: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    delta: [0, -1, 0],
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
    ],
  },
  {
    delta: [0, 0, 1],
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    delta: [0, 0, -1],
    normal: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
])

function boundsFor(positions) {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[offset + axis])
      max[axis] = Math.max(max[axis], positions[offset + axis])
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function unionBounds(meshes) {
  if (meshes.length === 0) return undefined
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const mesh of meshes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.primitive.bounds.min[axis])
      max[axis] = Math.max(max[axis], mesh.primitive.bounds.max[axis])
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function decodedGeometry(model, budget) {
  const meshes = []
  const materialIds = new Set()
  for (const [sectionIndex, section] of model.sections.entries()) {
    const occupied = new Set(section.voxels.map(voxel => voxelKey(voxel.x, voxel.y, voxel.z)))
    const metrics = [
      axisMetrics(section.min[0], section.max[0], section.dimensions.x),
      axisMetrics(section.min[1], section.max[1], section.dimensions.y),
      axisMetrics(section.min[2], section.max[2], section.dimensions.z),
    ]
    const builders = new Map()
    for (const voxel of section.voxels) {
      let builder = builders.get(voxel.colorIndex)
      if (builder === undefined) {
        builder = { positions: [], normals: [], textureCoordinates: [], indices: [] }
        builders.set(voxel.colorIndex, builder)
      }
      materialIds.add(`vxl-material-${voxel.colorIndex}`)
      const origin = [
        metrics[0].min + voxel.x * metrics[0].step,
        metrics[1].min + voxel.y * metrics[1].step,
        metrics[2].min + voxel.z * metrics[2].step,
      ]
      for (const face of FACES) {
        if (
          occupied.has(
            voxelKey(voxel.x + face.delta[0], voxel.y + face.delta[1], voxel.z + face.delta[2]),
          )
        )
          continue
        const base = builder.positions.length / 3
        for (const corner of face.corners) {
          builder.positions.push(
            ...toUvm([
              origin[0] + corner[0] * metrics[0].step,
              origin[1] + corner[1] * metrics[1].step,
              origin[2] + corner[2] * metrics[2].step,
            ]),
          )
          builder.normals.push(...toUvm(face.normal))
        }
        builder.textureCoordinates.push(0, 0, 1, 0, 1, 1, 0, 1)
        builder.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    }
    let colorSlot = 0
    for (const [colorIndex, builder] of builders) {
      if (builder.indices.length === 0) continue
      const positions = Float32Array.from(builder.positions)
      const primitive = Object.freeze({
        id: `vxl-primitive-${sectionIndex}-${colorSlot}`,
        topology: 'triangles',
        positions,
        normals: Float32Array.from(builder.normals),
        textureCoordinates: Float32Array.from(builder.textureCoordinates),
        indices: Uint32Array.from(builder.indices),
        materialId: `vxl-material-${colorIndex}`,
        bounds: boundsFor(positions),
      })
      meshes.push(
        Object.freeze({
          id: `vxl-mesh-${sectionIndex}-${colorSlot}`,
          sectionId: section.id,
          name: `${section.name} palette ${colorIndex}`,
          primitive,
        }),
      )
      colorSlot += 1
    }
  }
  const decodedBytes = meshes.reduce(
    (sum, mesh) =>
      sum +
      mesh.primitive.positions.byteLength +
      mesh.primitive.normals.byteLength +
      mesh.primitive.textureCoordinates.byteLength +
      mesh.primitive.indices.byteLength,
    0,
  )
  if (decodedBytes > budget.maxScalarBytes)
    throw new RangeError('VXL geometry exceeds maxScalarBytes')
  return Object.freeze({
    meshes: Object.freeze(meshes),
    materialIds: Object.freeze([...materialIds]),
    bounds: unionBounds(meshes),
    decodedBytes,
  })
}

function modelSource(model, geometry, facts, animations) {
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: model.sections.length,
      meshes: geometry.meshes.length,
      primitives: geometry.meshes.length,
      materials: geometry.materialIds.length,
      textures: 0,
      animations,
      ...(geometry.bounds === undefined ? {} : { bounds: geometry.bounds }),
      geometryAccess: geometry.meshes.length > 0 ? 'decoded' : 'metadata-only',
    },
    nodes: model.sections.map((section, index) => ({
      id: section.id,
      name: section.name,
      childIds: [],
      meshIds: geometry.meshes.filter(mesh => mesh.sectionId === section.id).map(mesh => mesh.id),
      // the HVA rest pose when one was bound by name, identity otherwise — never a pose guessed
      // from section order, and never the tailer transform standing in for one
      transform: restTransformOf(facts.binding[index]),
    })),
    meshes: geometry.meshes.map(mesh => ({
      id: mesh.id,
      name: mesh.name,
      primitiveIds: [mesh.primitive.id],
    })),
    primitives: geometry.meshes.map(mesh => mesh.primitive),
  })
}

/**
 * The bound rest pose as a 4x4 column-major matrix, or identity when nothing was bound.
 *
 * HVA stores a 3x4 row-major affine matrix; the render contract wants 4x4 column-major, so the
 * rows become columns and the last column becomes the translation row. An unbound section keeps
 * identity — the honest statement that this file said nothing about where the section rests.
 */
function restTransformOf(fact) {
  const matrix = fact?.provenance === 'companion' ? fact.restTransform : null
  if (matrix === null || matrix === undefined || matrix.length !== 12) return IDENTITY
  return Object.freeze([
    matrix[0],
    matrix[4],
    matrix[8],
    0,
    matrix[1],
    matrix[5],
    matrix[9],
    0,
    matrix[2],
    matrix[6],
    matrix[10],
    0,
    matrix[3],
    matrix[7],
    matrix[11],
    1,
  ])
}

function sectionSummary(section) {
  return Object.freeze({
    id: section.id,
    name: section.name,
    number: section.number,
    dimensions: section.dimensions,
    min: section.min,
    max: section.max,
    normalsType: section.normalsType,
    spanOffsets: section.spanOffsets,
    voxels: section.voxels.length,
  })
}

const HVA_REQUIREMENT = 'hva'

/**
 * The pattern this codec declares for its animation sidecar.
 *
 * A `.hva` is named after the `.vxl` beside it, so when the host-issued source identity ends in a
 * readable `*.vxl` name the declaration is exact and a folder holding several models still resolves
 * unambiguously. When it does not — an archive entry whose reference carries an opaque id rather
 * than its path — the codec falls back to the broad `*.hva`, and a container holding more than one
 * sidecar then ends in the resolver's ambiguity refusal instead of a guess. Deriving a *pattern*
 * from one's own identity is not resolving a companion: the host still does all of the looking.
 */
function hvaPatterns(uri) {
  let decoded = uri
  try {
    decoded = decodeURIComponent(uri)
  } catch {
    decoded = uri
  }
  const name = decoded.split(/[?#]/u, 1)[0]?.split(/[/\\]/u).at(-1) ?? ''
  const match = /^(?<stem>.+)\.vxl$/iu.exec(name)
  const stem = match?.groups?.['stem']
  return stem === undefined || stem.length === 0 ? ['*.hva'] : [`${stem}.hva`]
}

function hvaDiagnostic(id, severity, code, message, data) {
  return Object.freeze({
    id,
    severity,
    code,
    message,
    category: 'dependency',
    ...(data === undefined ? {} : { data }),
  })
}

/**
 * Reads the bound `.hva`, if the host bound one, and reports every outcome by name.
 *
 * Returns the parsed sidecar plus the diagnostics that explain what it did and did not cover. A
 * sidecar that fails to parse degrades this one capability and is reported; it never fails the
 * model, because a corrupt companion is not a corrupt subject.
 */
async function readHva(input, budget, signal) {
  const bindings = input.bindingsFor?.(HVA_REQUIREMENT) ?? []
  const binding = bindings[0]
  if (binding === undefined) {
    return { hva: null, bindingId: null, diagnostics: [], state: 'absent' }
  }
  const lease = await input.openBinding(binding.bindingId, signal)
  try {
    if (lease.value.kind !== 'bytes') throw new TypeError('HVA companion is not a byte source')
    const size = Number(lease.value.size ?? 0n)
    const bytes = await lease.value.read(0n, size, signal)
    const hva = parseHva(bytes, budget)
    const diagnostics = []
    if (hva.trailingBytes > 0) {
      diagnostics.push(
        hvaDiagnostic(
          'hva-trailing-bytes',
          'warning',
          'x3.vxl/hva-trailing-bytes',
          `the HVA companion carries ${hva.trailingBytes} bytes the header does not describe`,
          { bindingId: binding.bindingId, trailingBytes: hva.trailingBytes },
        ),
      )
    }
    return { hva, bindingId: binding.bindingId, diagnostics, state: 'resolved' }
  } catch (error) {
    // a sidecar that will not parse is a named, contained failure — the voxel model still opens
    return {
      hva: null,
      bindingId: binding.bindingId,
      state: 'corrupt',
      diagnostics: [
        hvaDiagnostic(
          'hva-unreadable',
          'error',
          'x3.vxl/hva-unreadable',
          `the bound HVA companion could not be read: ${error instanceof Error ? error.message : String(error)}`,
          { bindingId: binding.bindingId },
        ),
      ],
    }
  } finally {
    await lease.release()
  }
}

/** Per-section provenance: every published value says whether it came from the file or a binding. */
function hvaSectionFacts(model, companion) {
  if (companion.hva === null) {
    const reason = companion.state === 'corrupt' ? 'companion-unreadable' : 'no-companion'
    return {
      binding: model.sections.map(() => Object.freeze({ provenance: 'absent', reason })),
      diagnostics: [],
    }
  }
  const { matches, unclaimed } = bindSections(
    model.sections.map(section => section.name),
    companion.hva,
  )
  const diagnostics = []
  matches.forEach((match, index) => {
    if (match.state === 'matched') return
    diagnostics.push(
      hvaDiagnostic(
        `hva-section-${index}`,
        'warning',
        `x3.vxl/hva-section-${match.state}`,
        `VXL section «${model.sections[index]?.name ?? index}» has no HVA counterpart it can be bound to by name (${match.reason})`,
        { section: model.sections[index]?.name ?? String(index), reason: match.reason },
      ),
    )
  })
  if (unclaimed.length > 0) {
    diagnostics.push(
      hvaDiagnostic(
        'hva-unclaimed-sections',
        'warning',
        'x3.vxl/hva-unclaimed-sections',
        `the HVA companion declares ${unclaimed.length} section(s) this model does not name`,
        { sections: unclaimed.map(item => item.name) },
      ),
    )
  }
  const binding = matches.map(match =>
    match.state === 'matched'
      ? Object.freeze({
          provenance: 'companion',
          bindingId: companion.bindingId,
          hvaSectionName: match.hvaSectionName,
          hvaIndex: match.hvaIndex,
          // frame 0 is the rest pose; a single-frame HVA carries nothing else
          restTransform: hvaMatrix(companion.hva, match.hvaIndex, 0) ?? null,
        })
      : Object.freeze({ provenance: 'absent', reason: match.reason }),
  )
  return { binding, diagnostics }
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'red-alert2-vxl', label: 'Red Alert 2 VXL voxel model' }),
  async planInput(source) {
    return Object.freeze({
      originKind: 'bundle',
      candidate: Object.freeze({ bindingId: 'content', role: 'content', ownership: 'owned' }),
      requirements: Object.freeze([
        Object.freeze({
          id: HVA_REQUIREMENT,
          role: 'hva',
          ownership: 'companion',
          patterns: Object.freeze(hvaPatterns(source.ref.uri)),
          scopes: Object.freeze(['sibling-directory', 'current-mount', 'enclosing-container']),
          // a VXL without its sidecar is a legal, complete voxel model
          cardinality: 'zero-or-one',
          required: false,
        }),
      ]),
    })
  },
  async detect(prefix) {
    return signature(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'Voxel Animation header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const model = parse(bytes, context.budget)
    const geometry = decodedGeometry(model, context.budget)
    const voxelCount = model.sections.reduce((sum, section) => sum + section.voxels.length, 0)
    const companion = await readHva(context.input, context.budget, context.signal)
    const facts = hvaSectionFacts(model, companion)
    const bound = facts.binding.filter(item => item.provenance === 'companion').length
    /*
     * One frame is a rest pose, not an animation — so the animation count is the number of tracks
     * actually present, which is zero for a single-frame sidecar however many sections it binds.
     * Reporting otherwise would turn an identity pose into "an animation was read".
     */
    const animations = companion.hva !== null && companion.hva.frames > 1 && bound > 0 ? 1 : 0
    return {
      summary: {
        format: 'red-alert2-vxl',
        fileType: model.header.fileType,
        palettes: model.header.palettes,
        sections: model.sections.map((section, index) => ({
          ...sectionSummary(section),
          // the tailer transform is in the file; the HVA one is not, and says so
          transformProvenance: 'direct',
          hva: facts.binding[index],
        })),
        hva:
          companion.hva === null
            ? { state: companion.state }
            : {
                state: companion.state,
                bindingId: companion.bindingId,
                frames: companion.hva.frames,
                sections: companion.hva.sectionCount,
                boundSections: bound,
                // named for what it is: a pose has no track
                kind: companion.hva.frames > 1 ? 'animation' : 'rest-pose',
              },
        bodyBytes: model.header.bodyBytes,
        paletteRemap: [model.header.startPaletteRemap, model.header.endPaletteRemap],
        voxels: voxelCount,
        decodedMeshes: geometry.meshes.length,
        decodedTriangles: geometry.meshes.reduce(
          (sum, mesh) => sum + mesh.primitive.indices.length / 3,
          0,
        ),
        geometryAccess: geometry.meshes.length > 0 ? 'decoded' : 'metadata-only',
      },
      metadata: [
        {
          id: 'red-alert2-vxl',
          label: 'Westwood voxel model',
          entries: [
            { key: 'sections', value: model.sections.length },
            { key: 'bodyBytes', value: model.header.bodyBytes },
            { key: 'palettes', value: model.header.palettes },
            { key: 'voxels', value: voxelCount },
            { key: 'decodedMeshes', value: geometry.meshes.length },
            {
              key: 'geometryAccess',
              value: geometry.meshes.length > 0 ? 'decoded' : 'metadata-only',
            },
            /*
             * Where the section transforms came from.
             *
             * `summary.hva` has carried this all along, but a summary is not part of the
             * descriptor a viewer sees — so a reader looking at a bound model had no way to tell
             * it apart from an unbound one. The `model.animations` trait does say
             * `provenance=companion`, and only when there is an animation to attribute: a
             * single-frame sidecar is a rest pose, correctly not an animation, and it left the
             * binding invisible. These rows state the binding itself, pose or track.
             */
            { key: 'companionState', value: companion.state },
            ...(companion.hva === null
              ? []
              : [
                  { key: 'companionBindingId', value: companion.bindingId },
                  { key: 'companionFrames', value: companion.hva.frames },
                  { key: 'companionBoundSections', value: bound },
                  {
                    key: 'companionKind',
                    value: companion.hva.frames > 1 ? 'animation' : 'rest-pose',
                  },
                ]),
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: {
            sections: model.sections.length,
            meshes: geometry.meshes.length,
            decoded: geometry.meshes.length > 0,
          },
        },
        { id: 'structure.hierarchy', parameters: { nodes: model.sections.length } },
        ...(animations > 0
          ? [
              {
                id: 'model.animations',
                parameters: {
                  animations,
                  frames: companion.hva?.frames ?? 0,
                  boundSections: bound,
                  provenance: 'companion',
                },
              },
            ]
          : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/model-scene-source': modelSource(model, geometry, facts, animations),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'Red Alert 2 VXL',
          preview: `${model.sections.length} sections`,
          children: model.sections.map(section => ({
            kind: 'section',
            label: section.name,
            preview: `${section.dimensions.x}×${section.dimensions.y}×${section.dimensions.z}, normals ${section.normalsType}`,
          })),
        }),
      },
      diagnostics: [...companion.diagnostics, ...facts.diagnostics],
      companions: [
        {
          id: HVA_REQUIREMENT,
          role: 'hva',
          cardinality: 'zero-or-one',
          required: false,
          ...(companion.bindingId === null
            ? { state: 'missing' }
            : { state: 'resolved', bindingIds: [companion.bindingId] }),
        },
      ],
      maxDecodedBytes: Math.max(bytes.byteLength, geometry.decodedBytes),
      unsupportedFeatures: [
        ...(geometry.meshes.length === 0 ? ['remaining-vxl-span-variants'] : []),
        'pal-and-vpl-lighting-sidecar-resolution',
        'voxel-model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
