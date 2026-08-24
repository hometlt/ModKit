// Hierarchy, animation, HLOD and material planes of the Westwood W3D chunk tree.
//
// Everything here is read from documented chunk layouts and validated against the corpus this
// repository can actually reach: `d_teslacoil_ch.w3d` (Apocalypse Rising, TS/RA2-era authoring) and
// `bowl.w3d` out of Command & Conquer 3's `Misc.big`. Chunk types the corpus does not exercise are
// not implemented from the specification alone — they are reported as unsupported with their bytes
// left intact, because a decoder written against a document and never run against a file is a
// decoder nobody has tested.
//
// Two bindings matter and both are explicit:
//
//  * a pivot's parent is the `parentIndex` field, not its position in the array;
//  * a mesh belongs to a bone because an `HLOD_SUB_OBJECT` says so by name and bone index — never
//    because a mesh and a pivot happen to share a name.

export const CHUNK = Object.freeze({
  MESH: 0x0,
  VERTICES: 0x2,
  VERTEX_NORMALS: 0x3,
  MESH_HEADER3: 0x1f,
  TRIANGLES: 0x20,
  MATERIAL_INFO: 0x28,
  VERTEX_MATERIALS: 0x2c,
  VERTEX_MATERIAL: 0x2d,
  VERTEX_MATERIAL_NAME: 0x2e,
  TEXTURES: 0x30,
  TEXTURE: 0x31,
  TEXTURE_NAME: 0x32,
  MATERIAL_PASS: 0x38,
  STAGE_TEXCOORDS: 0x4a,
  HIERARCHY: 0x100,
  HIERARCHY_HEADER: 0x101,
  PIVOTS: 0x102,
  PIVOT_FIXUPS: 0x103,
  ANIMATION: 0x200,
  ANIMATION_HEADER: 0x201,
  ANIMATION_CHANNEL: 0x202,
  BIT_CHANNEL: 0x203,
  COMPRESSED_ANIMATION: 0x280,
  BOX: 0x740,
  HLOD: 0x700,
  HLOD_HEADER: 0x701,
  HLOD_LOD_ARRAY: 0x702,
  HLOD_SUB_OBJECT_ARRAY_HEADER: 0x703,
  HLOD_SUB_OBJECT: 0x704,
})

/** Collision bits of `MESH_HEADER3.attributes`; the mask is the documented `COLLISION_TYPE_MASK`. */
const COLLISION_MASK = 0x0ff0
const COLLISION_BITS = Object.freeze([
  [0x0010, 'physical'],
  [0x0020, 'projectile'],
  [0x0040, 'vis'],
  [0x0080, 'camera'],
  [0x0100, 'vehicle'],
])
const HIDDEN = 0x1000

/**
 * A texture reference must be a plain name; anything naming a location is not a name.
 *
 * Both separators, because W3D was authored on Windows and the strings in the wild use either.
 */
const LOCATION_LIKE = /[\\/]|^[A-Za-z]:|^[a-z][a-z0-9+.-]*:/u

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export function fixedString(bytes, offset, length) {
  const end = Math.min(bytes.byteLength, offset + length)
  let cursor = offset
  while (cursor < end && bytes[cursor] !== 0) cursor += 1
  return new TextDecoder().decode(bytes.subarray(offset, cursor)).trim()
}

function firstOf(chunks, type) {
  return chunks.find(chunk => chunk.type === type)
}

function vec3(data, offset) {
  return Object.freeze([
    data.getFloat32(offset, true),
    data.getFloat32(offset + 4, true),
    data.getFloat32(offset + 8, true),
  ])
}

/**
 * `HIERARCHY` → named pivots with explicit parents.
 *
 * The pivot record length is derived from the payload rather than assumed, because W3D shipped
 * several pivot layouts; a file whose records are too short to carry a parent index is reported as
 * undecodable instead of being read with a guessed stride.
 */
export function parseHierarchy(bytes, chunks, issues) {
  const hierarchy = firstOf(chunks, CHUNK.HIERARCHY)
  if (hierarchy === undefined) return undefined
  const header = firstOf(hierarchy.children, CHUNK.HIERARCHY_HEADER)
  const pivots = firstOf(hierarchy.children, CHUNK.PIVOTS)
  if (header === undefined || pivots === undefined || header.size < 24) {
    issues.push({
      code: 'westwood-w3d-hierarchy-header-missing',
      message: 'a W3D hierarchy chunk carries no decodable header or pivot table',
    })
    return undefined
  }
  const data = view(bytes)
  const name = fixedString(bytes, header.payloadStart + 4, 16) || 'W3DHierarchy'
  const count = data.getUint32(header.payloadStart + 20, true)
  if (count === 0) return Object.freeze({ name, pivots: Object.freeze([]), recordBytes: 0 })
  const recordBytes = Math.floor(pivots.size / count)
  if (recordBytes < 20) {
    issues.push({
      code: 'westwood-w3d-pivot-layout-unsupported',
      message: `W3D hierarchy «${name}» has pivot records too short to decode (${recordBytes} bytes)`,
    })
    return Object.freeze({ name, pivots: Object.freeze([]), recordBytes })
  }
  const records = []
  for (let index = 0; index < count; index += 1) {
    const offset = pivots.payloadStart + index * recordBytes
    if (offset + recordBytes > pivots.payloadEnd) break
    const parentIndex = data.getInt32(offset + 16, true)
    records.push(
      Object.freeze({
        index,
        name: fixedString(bytes, offset, 16) || `Pivot_${index}`,
        // -1 is the documented "no parent"; anything outside the table is reported, not clamped
        parentIndex: parentIndex >= -1 && parentIndex < count ? parentIndex : -1,
        parentOutOfRange: parentIndex < -1 || parentIndex >= count,
        translation: recordBytes >= 32 ? vec3(data, offset + 20) : Object.freeze([0, 0, 0]),
        rotation:
          recordBytes >= 60
            ? Object.freeze([
                data.getFloat32(offset + 44, true),
                data.getFloat32(offset + 48, true),
                data.getFloat32(offset + 52, true),
                data.getFloat32(offset + 56, true),
              ])
            : Object.freeze([0, 0, 0, 1]),
      }),
    )
  }
  for (const pivot of records) {
    if (pivot.parentOutOfRange) {
      issues.push({
        code: 'westwood-w3d-pivot-parent-out-of-range',
        message: `W3D pivot «${pivot.name}» names a parent outside the hierarchy and was left unparented`,
      })
    }
  }
  return Object.freeze({ name, pivots: Object.freeze(records), recordBytes })
}

/** Flags 0..2 are the translation axes; 3 is an orientation quaternion. */
function channelKind(flags) {
  if (flags === 0) return { kind: 'translation', axis: 'x', components: 1 }
  if (flags === 1) return { kind: 'translation', axis: 'y', components: 1 }
  if (flags === 2) return { kind: 'translation', axis: 'z', components: 1 }
  if (flags === 3) return { kind: 'rotation', components: 4 }
  return undefined
}

/**
 * `ANIMATION` → per-pivot keyframe channels.
 *
 * Only `ANIMATION_CHANNEL` (0x202) is decoded. `BIT_CHANNEL` (0x203) and `COMPRESSED_ANIMATION`
 * (0x280) are counted and reported as unsupported: neither appears anywhere in the corpus this
 * repository can read, so there is nothing to validate an implementation against.
 */
export function parseAnimations(bytes, chunks, issues) {
  const data = view(bytes)
  const animations = []
  for (const chunk of chunks) {
    if (chunk.type !== CHUNK.ANIMATION) continue
    const header = firstOf(chunk.children, CHUNK.ANIMATION_HEADER)
    if (header === undefined || header.size < 44) {
      issues.push({
        code: 'westwood-w3d-animation-header-missing',
        message: 'a W3D animation chunk carries no decodable 44-byte header and was skipped',
      })
      continue
    }
    const name = fixedString(bytes, header.payloadStart + 4, 16) || 'W3DAnimation'
    const record = {
      name,
      hierarchyName: fixedString(bytes, header.payloadStart + 20, 16),
      frames: data.getUint32(header.payloadStart + 36, true),
      frameRate: data.getUint32(header.payloadStart + 40, true),
      channels: [],
      unsupportedChannels: 0,
    }
    for (const child of chunk.children) {
      if (child.type === CHUNK.BIT_CHANNEL) {
        record.unsupportedChannels += 1
        continue
      }
      if (child.type !== CHUNK.ANIMATION_CHANNEL) continue
      if (child.size < 12) {
        issues.push({
          code: 'westwood-w3d-animation-channel-short',
          message: `W3D animation «${name}» has a channel header shorter than 12 bytes`,
        })
        continue
      }
      const firstFrame = data.getUint16(child.payloadStart, true)
      const lastFrame = data.getUint16(child.payloadStart + 2, true)
      const vectorLen = data.getUint16(child.payloadStart + 4, true)
      const flags = data.getUint16(child.payloadStart + 6, true)
      const pivot = data.getUint16(child.payloadStart + 8, true)
      const shape = channelKind(flags)
      const frameCount = lastFrame >= firstFrame ? lastFrame - firstFrame + 1 : 0
      const needed = 12 + frameCount * vectorLen * 4
      if (shape === undefined || vectorLen !== shape.components || child.size < needed) {
        record.unsupportedChannels += 1
        issues.push({
          code: 'westwood-w3d-animation-channel-unsupported',
          message:
            `W3D animation «${name}» channel for pivot ${pivot} declares flags ${flags} and ` +
            `vector length ${vectorLen} in ${child.size} bytes, which this reader does not decode`,
        })
        continue
      }
      const values = new Float32Array(frameCount * vectorLen)
      for (let index = 0; index < values.length; index += 1) {
        values[index] = data.getFloat32(child.payloadStart + 12 + index * 4, true)
      }
      record.channels.push(
        Object.freeze({
          pivot,
          kind: shape.kind,
          ...(shape.axis === undefined ? {} : { axis: shape.axis }),
          firstFrame,
          lastFrame,
          components: vectorLen,
          values,
        }),
      )
    }
    animations.push(Object.freeze({ ...record, channels: Object.freeze(record.channels) }))
  }
  return Object.freeze(animations)
}

/** Chunk types this reader deliberately does not decode, with the bytes they occupy. */
export function unsupportedAnimationChunks(chunks) {
  const compressed = chunks.filter(chunk => chunk.type === CHUNK.COMPRESSED_ANIMATION)
  return Object.freeze(
    compressed.map(chunk =>
      Object.freeze({
        type: 'compressed-animation',
        chunkId: chunk.id,
        offset: chunk.offset,
        // the payload is untouched and still addressable through the byte-range source
        preservedBytes: chunk.size,
      }),
    ),
  )
}

/**
 * `HLOD` → the explicit mesh-to-bone table.
 *
 * A sub-object names its mesh as `CONTAINER.MESH` and the bone by index. Both halves are used: the
 * name identifies which mesh, the index identifies which pivot. Nothing is inferred from a mesh and
 * a pivot merely sharing a name.
 */
export function parseHlod(bytes, chunks) {
  const hlod = firstOf(chunks, CHUNK.HLOD)
  if (hlod === undefined) return undefined
  const header = firstOf(hlod.children, CHUNK.HLOD_HEADER)
  const data = view(bytes)
  const subObjects = []
  const collect = nodes => {
    for (const node of nodes) {
      if (node.type === CHUNK.HLOD_SUB_OBJECT && node.size >= 8) {
        subObjects.push(
          Object.freeze({
            boneIndex: data.getUint32(node.payloadStart, true),
            name: fixedString(bytes, node.payloadStart + 4, 32),
          }),
        )
      }
      collect(node.children)
    }
  }
  collect(hlod.children)
  return Object.freeze({
    name: header === undefined ? '' : fixedString(bytes, header.payloadStart + 8, 16),
    hierarchyName: header === undefined ? '' : fixedString(bytes, header.payloadStart + 24, 16),
    lodCount:
      header === undefined || header.size < 8 ? 0 : data.getUint32(header.payloadStart + 4, true),
    subObjects: Object.freeze(subObjects),
  })
}

/**
 * Render / collision / proxy marking, read from `MESH_HEADER3.attributes` and nothing else.
 *
 * A mesh is a collider when it says so. The block-8 matrix is explicit that an ordinary render mesh
 * must never be published as collision geometry, so the absence of a collision bit yields
 * `render`, not a guess from the mesh's name or its position in the file.
 */
export function meshRoles(attributes) {
  const collisionTypes = COLLISION_BITS.flatMap(([bit, label]) =>
    (attributes & bit) !== 0 ? [label] : [],
  )
  return Object.freeze({
    attributes,
    collisionTypes: Object.freeze(collisionTypes),
    hidden: (attributes & HIDDEN) !== 0,
    // a mesh with no collision bit is render geometry; one with them is a collider that may also
    // be drawn — the two are reported separately rather than folded into a single "kind"
    render: (attributes & COLLISION_MASK) === 0 || collisionTypes.length === 0,
    collision: (attributes & COLLISION_MASK) !== 0,
  })
}

/**
 * A bounded walk of chunk *headers* that collects the texture names a model references.
 *
 * This is what `planInput` runs, and it is deliberately not a decode: it reads a fixed window from
 * the front of the file, follows the eight-byte headers, and copies the payload of `TEXTURE_NAME`
 * chunks. No vertex stream is touched and no tree is built, so declaring companions costs a fixed,
 * testable amount of work rather than a full parse before the real parse.
 *
 * The names are used as *exact* companion patterns. A model that references
 * `d_prismtwr_linear.dds` asks the host for that file and nothing else — which is why this can be
 * a narrow declaration rather than the `*.dds` scan an earlier slice refused to introduce.
 */
export function scanTextureNames(bytes, limits) {
  const maxHeaders = limits?.maxHeaders ?? 4096
  const maxDepth = limits?.maxDepth ?? 6
  const maxNames = limits?.maxNames ?? 64
  const names = []
  const seen = new Set()
  let headers = 0
  let truncated = false
  const data = view(bytes)
  const walk = (start, end, depth) => {
    if (depth > maxDepth) return
    let cursor = start
    while (cursor + 8 <= end) {
      if (headers >= maxHeaders) {
        truncated = true
        return
      }
      headers += 1
      const type = data.getUint32(cursor, true)
      const sizeField = data.getUint32(cursor + 4, true)
      const size = sizeField & 0x7fffffff
      const payloadStart = cursor + 8
      const payloadEnd = payloadStart + size
      if (!Number.isSafeInteger(payloadEnd) || payloadEnd > end) {
        // the window cut a chunk in half, or the file is malformed — either way, stop here and say so
        truncated = true
        return
      }
      if (type === CHUNK.TEXTURE_NAME) {
        const value = fixedString(bytes, payloadStart, size)
        const key = value.toLowerCase()
        /*
         * A texture name comes out of the file, so a crafted model can put a location where a name
         * belongs. Such a reference is dropped here rather than declared: a requirement carrying
         * `..\..\evil` is refused by the resolver as an invalid pattern, and that refusal fails
         * the whole open — which would let one hostile chunk cost a reader the geometry in all the
         * others. The name is still reported in the summary; it simply never becomes a search.
         */
        if (value !== '' && !seen.has(key) && !LOCATION_LIKE.test(value)) {
          if (names.length >= maxNames) {
            truncated = true
            return
          }
          seen.add(key)
          names.push(value)
        }
      }
      if ((sizeField & 0x80000000) !== 0) walk(payloadStart, payloadEnd, depth + 1)
      cursor = payloadEnd
    }
  }
  walk(0, bytes.byteLength, 0)
  return Object.freeze({ names: Object.freeze(names), headers, truncated })
}

/** Explicit collision volumes: `BOX` chunks, which are collision by declaration, not by shape. */
export function parseCollisionBoxes(bytes, chunks) {
  const data = view(bytes)
  return Object.freeze(
    chunks
      .filter(chunk => chunk.type === CHUNK.BOX && chunk.size >= 68)
      .map(chunk =>
        Object.freeze({
          name: fixedString(bytes, chunk.payloadStart + 8, 32),
          collisionTypes: Object.freeze(
            COLLISION_BITS.flatMap(([bit, label]) =>
              (data.getUint32(chunk.payloadStart + 4, true) & bit) !== 0 ? [label] : [],
            ),
          ),
        }),
      ),
  )
}
