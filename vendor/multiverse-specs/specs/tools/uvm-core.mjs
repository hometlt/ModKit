/**
 * Reference reader and GLB packer for the UVM/core 1.0 profile.
 *
 * Scope: exactly what `model-interchange-v1` needs from a UVM artifact, and nothing more. It is
 * not a full UVM implementation: the optional `UV_*` planes (materials, skeleton, animation
 * clips, effects, collision, LOD, variants) are read as counts or ignored, because 1.0 of the
 * scope hashes counts and structure, not those planes.
 *
 * The fixture source form is `.uvm.gltf` with one `data:` buffer, because a spec repository has
 * to be diffable. `packGlb` produces the `.uvm.glb` bytes from it under a documented, byte-stable
 * rule, which is what makes "repeat materialisation is byte-stable" checkable here rather than
 * only downstream.
 *
 * Dependency-free by design: Node built-ins only.
 */

import { readFileSync } from 'node:fs'

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const COMPONENT_BYTES = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }
const COMPONENT_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function concat(...parts) {
  const total = parts.reduce((size, part) => size + part.byteLength, 0)
  const result = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    result.set(part, cursor)
    cursor += part.byteLength
  }
  return result
}

function le32(value) {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, true)
  return result
}

function pad4(bytes, fill) {
  const result = new Uint8Array((bytes.byteLength + 3) & ~3)
  result.fill(fill)
  result.set(bytes)
  return result
}

// --- fixture source form -----------------------------------------------------------------------

const DATA_URI = /^data:application\/(?:octet-stream|gltf-buffer);base64,([A-Za-z0-9+/=]*)$/u

/**
 * Read a `.uvm.gltf` fixture whose single buffer is a base64 `data:` URI.
 *
 * Returns the GLB-shaped pair: the document with the buffer uri removed, plus the BIN payload.
 */
export function readGltfFixture(path) {
  const document = JSON.parse(readFileSync(path, 'utf8'))
  const buffers = document.buffers ?? []
  if (buffers.length !== 1) {
    throw new TypeError(`${path}: a UVM/core fixture carries exactly one buffer`)
  }
  const match = DATA_URI.exec(buffers[0].uri ?? '')
  if (match === null) throw new TypeError(`${path}: buffer 0 must be a base64 data: URI`)
  const binary = new Uint8Array(Buffer.from(match[1], 'base64'))
  if (binary.byteLength !== buffers[0].byteLength) {
    throw new TypeError(
      `${path}: buffer byteLength ${buffers[0].byteLength} does not match the ${binary.byteLength} decoded bytes`,
    )
  }
  const packed = { ...document, buffers: [{ byteLength: binary.byteLength }] }
  return { document: packed, binary }
}

/**
 * Pack a GLB-shaped document plus BIN payload into `.uvm.glb` bytes.
 *
 * Byte stability rule: JSON is `JSON.stringify` of the document with no whitespace, so the key
 * order committed in the fixture is the key order on the wire; the JSON chunk is padded with
 * 0x20 and the BIN chunk with 0x00 to the next multiple of four. Nothing here depends on hash
 * iteration order, so packing the same fixture twice produces the same bytes.
 */
export function packGlb(document, binary) {
  const json = pad4(encoder.encode(JSON.stringify(document)), 0x20)
  const bin = pad4(binary, 0x00)
  const jsonChunk = concat(le32(json.byteLength), le32(JSON_CHUNK), json)
  const binChunk = concat(le32(bin.byteLength), le32(BIN_CHUNK), bin)
  const length = 12 + jsonChunk.byteLength + binChunk.byteLength
  return concat(le32(GLB_MAGIC), le32(2), le32(length), jsonChunk, binChunk)
}

export function unpackGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new TypeError('UVM requires the GLB magic')
  }
  if (view.getUint32(4, true) !== 2) throw new TypeError('UVM requires GLB version 2')
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new TypeError('UVM GLB declared length does not match the source')
  }
  let cursor = 12
  let document
  let binary = new Uint8Array()
  while (cursor < bytes.byteLength) {
    const length = view.getUint32(cursor, true)
    const type = view.getUint32(cursor + 4, true)
    const start = cursor + 8
    const end = start + length
    if (end > bytes.byteLength) throw new TypeError('UVM GLB chunk exceeds the source length')
    if (type === JSON_CHUNK) {
      document = JSON.parse(decoder.decode(bytes.subarray(start, end)).replace(/[\u0000\u0020]+$/u, ''))
    } else if (type === BIN_CHUNK) {
      binary = bytes.slice(start, end)
    }
    cursor = end
  }
  if (document === undefined) throw new TypeError('UVM GLB has no JSON chunk')
  return { document, binary }
}

// --- profile marker ----------------------------------------------------------------------------

/** Assert the UVM/core 1.0 markers the profile requires. Throws with the failing rule named. */
export function assertUvmCore(document) {
  const asset = document.asset
  if (asset?.version !== '2.0') throw new TypeError('UVM asset.version must be 2.0')
  const uv = asset.extras?.uv
  if (uv?.format !== 'UVM' || uv.version !== '1.0' || uv.profile !== 'core') {
    throw new TypeError('asset.extras.uv must identify the UVM/core 1.0 profile')
  }
  const used = document.extensionsUsed ?? []
  for (const required of ['UV_asset', 'UV_provenance']) {
    if (!used.includes(required)) throw new TypeError(`${required} is not declared in extensionsUsed`)
    if (document.extensions?.[required] === undefined) {
      throw new TypeError(`${required} is declared but absent`)
    }
  }
  if ((document.extensionsRequired ?? []).some(id => String(id).startsWith('UV_'))) {
    throw new TypeError('UVM/core must not require a UV_ extension')
  }
  const identity = document.extensions.UV_asset
  if (typeof identity.id !== 'string' || identity.id.trim() === '') {
    throw new TypeError('UV_asset requires a non-empty id')
  }
  const provenance = document.extensions.UV_provenance
  if (
    typeof provenance.source?.format !== 'string' ||
    typeof provenance.importer?.id !== 'string' ||
    typeof provenance.importer?.version !== 'string'
  ) {
    throw new TypeError('UV_provenance requires source format and importer coordinate')
  }
  return document
}

// --- accessors ---------------------------------------------------------------------------------

function accessorValues(document, binary, accessorIndex, purpose) {
  const accessor = (document.accessors ?? [])[accessorIndex]
  if (accessor === undefined) throw new TypeError(`${purpose} accessor ${accessorIndex} is missing`)
  if (accessor.sparse !== undefined) throw new TypeError(`${purpose} sparse accessors are out of scope`)
  const width = COMPONENT_COUNTS[accessor.type]
  const bytesPerComponent = COMPONENT_BYTES[accessor.componentType]
  if (width === undefined || bytesPerComponent === undefined) {
    throw new TypeError(`${purpose} accessor shape is invalid`)
  }
  const bufferView = (document.bufferViews ?? [])[accessor.bufferView]
  if (bufferView === undefined) throw new TypeError(`${purpose} bufferView is missing`)
  if ((bufferView.buffer ?? 0) !== 0) throw new TypeError(`${purpose} references an external buffer`)
  const elementBytes = width * bytesPerComponent
  const stride = bufferView.byteStride ?? elementBytes
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const end = accessor.count === 0 ? start : start + (accessor.count - 1) * stride + elementBytes
  if (end > (bufferView.byteOffset ?? 0) + bufferView.byteLength || end > binary.byteLength) {
    throw new RangeError(`${purpose} accessor exceeds the UVM BIN chunk`)
  }
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  const scalarCount = accessor.count * width
  const result = purpose === 'indices' ? new Uint32Array(scalarCount) : new Float32Array(scalarCount)
  for (let item = 0; item < accessor.count; item += 1) {
    const itemOffset = start + item * stride
    for (let component = 0; component < width; component += 1) {
      const offset = itemOffset + component * bytesPerComponent
      const value =
        accessor.componentType === 5126
          ? view.getFloat32(offset, true)
          : accessor.componentType === 5125
            ? view.getUint32(offset, true)
            : accessor.componentType === 5123
              ? view.getUint16(offset, true)
              : view.getUint8(offset)
      result[item * width + component] = value
    }
  }
  return { values: result, count: accessor.count, width, componentType: accessor.componentType }
}

// --- artifact-side projection --------------------------------------------------------------------

/**
 * Derive the drained model-scene projection `model-interchange-v1` hashes from a UVM/core artifact.
 *
 * The id convention, the transform rule and the implied-index rule are the ones the descriptor
 * fixes under `bindings.artifactProfile`; they are identity, so they are normative, not local.
 */
export function projectionFromUvmCore(document, binary) {
  assertUvmCore(document)
  const nodes = document.nodes ?? []
  const meshes = document.meshes ?? []
  const primitives = []
  const modelMeshes = meshes.map((mesh, meshIndex) => {
    const primitiveIds = (mesh.primitives ?? []).map((primitive, primitiveIndex) => {
      if ((primitive.mode ?? 4) !== 4) throw new TypeError('UVM/core currently requires triangles')
      const position = accessorValues(document, binary, primitive.attributes?.POSITION, 'positions')
      if (position.width !== 3 || position.componentType !== 5126) {
        throw new TypeError('UVM POSITION must be a float VEC3 accessor')
      }
      const indices =
        primitive.indices === undefined
          ? Uint32Array.from({ length: position.count }, (_unused, index) => index)
          : accessorValues(document, binary, primitive.indices, 'indices').values
      const normals =
        primitive.attributes?.NORMAL === undefined
          ? undefined
          : accessorValues(document, binary, primitive.attributes.NORMAL, 'normals').values
      const textureCoordinates =
        primitive.attributes?.TEXCOORD_0 === undefined
          ? undefined
          : accessorValues(document, binary, primitive.attributes.TEXCOORD_0, 'texture coordinates')
              .values
      const id = `mesh-${meshIndex}-primitive-${primitiveIndex}`
      primitives.push({
        id,
        topology: 'triangles',
        positions: position.values,
        indices,
        ...(normals === undefined ? {} : { normals }),
        ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
        ...(Number.isSafeInteger(primitive.material)
          ? { materialId: `material-${primitive.material}` }
          : {}),
      })
      return id
    })
    return {
      id: `mesh-${meshIndex}`,
      ...(typeof mesh.name === 'string' ? { name: mesh.name } : {}),
      primitiveIds,
    }
  })
  const modelNodes = nodes.map((node, nodeIndex) => ({
    id: `node-${nodeIndex}`,
    ...(typeof node.name === 'string' ? { name: node.name } : {}),
    childIds: (node.children ?? []).map(child => `node-${child}`),
    meshIds: node.mesh === undefined ? [] : [`mesh-${node.mesh}`],
    transform:
      Array.isArray(node.matrix) && node.matrix.length === 16 && node.matrix.every(Number.isFinite)
        ? [...node.matrix]
        : [...IDENTITY],
  }))
  const bounds = (() => {
    if (primitives.length === 0) return undefined
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (const primitive of primitives) {
      for (let offset = 0; offset < primitive.positions.length; offset += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = primitive.positions[offset + axis]
          min[axis] = Math.min(min[axis], value)
          max[axis] = Math.max(max[axis], value)
        }
      }
    }
    return { min, max }
  })()
  return {
    info: {
      scenes: (document.scenes ?? []).length,
      nodes: modelNodes.length,
      meshes: modelMeshes.length,
      primitives: primitives.length,
      materials: (document.materials ?? []).length,
      textures: (document.textures ?? []).length,
      animations: (document.animations ?? []).length,
      ...(bounds === undefined ? {} : { bounds }),
      geometryAccess: 'decoded',
    },
    nodes: modelNodes,
    meshes: modelMeshes,
    primitives,
  }
}

/**
 * Derive the resource closure of a UVM/core artifact.
 *
 * Only external identity contributes: a GLB-embedded buffer has no logical identity outside the
 * artifact, so it produces no entry. `digests` supplies content digests the caller actually has;
 * a resource without one stays `null` and is never invented.
 */
export function resourceClosureFromUvmCore(document, { mode, digests = {} } = {}) {
  const entries = []
  for (const buffer of document.buffers ?? []) {
    if (typeof buffer.uri !== 'string' || buffer.uri.startsWith('data:')) continue
    entries.push({
      role: 'buffer',
      logicalId: buffer.uri,
      mediaHint: 'application/octet-stream',
      digest: digests[buffer.uri] ?? null,
    })
  }
  for (const image of document.images ?? []) {
    if (typeof image.uri !== 'string' || image.uri.startsWith('data:')) continue
    entries.push({
      role: 'image',
      logicalId: image.uri,
      mediaHint: typeof image.mimeType === 'string' ? image.mimeType : null,
      digest: digests[image.uri] ?? null,
    })
  }
  return { mode, entries }
}
